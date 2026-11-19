import base64
import concurrent.futures
import hashlib
import io
import json
import os
import re
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (S3, addresses, advance, click, fill, layout, licence_allowed,
                      mail_from_address, open_app, post_json, ready, same_origin, select, settle,
                      shipped_packages, soon, state_styles, style, tab_order, tap, until)
from conftest import text as mail_text

GRADING_KEY = "gk-ridgestack-7d3a91c4"
GK = {"X-Grading-Key": GRADING_KEY}
PASSWORD = "ridgestack-seed-1"
COOKIE = "ridgestack_session"
HTTP_ONLY = "HTTP-only".replace("-", "").lower()
CHECK_TIMEOUT_SECONDS = 600
QUEUE_STEP_SECONDS = 30
PUSH_LIMIT = 65536
JSON_LIMIT = 262144
DIFF_BREAKPOINT_PX = 768
LIVE_MS = 1250
TAP_MIN_PX = 44
TAP_BREAKPOINT_PX = 1024
NAV_GAP_PX = 10
HOVER_MAX_S = 0.5
WIDE = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
WORKSPACE_TZ = ZoneInfo("America/Denver")
HTTP_TIMEOUT = 30
POLL_SECONDS = 30
ACT_MS = 15000
POLL_STEP = 0.25
DEFAULT_SETTINGS = {"required_approvals": 1, "required_checks": [], "queue": False}
OUTAGE_PUSH = "Storage is unavailable. Nothing was saved. Try again in a moment."
OUTAGE_EXPORT = "Storage is unavailable. The archive was not exported. Try again in a moment."
REMOVED_UPDATED = "Removed: the change was updated while queued"
DIALOG_CONTROLS = {"Comment", "Add a suggestion", "Suggested lines", "Through line", "Add comment", "Cancel"}
ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"}
FONTS = ("Inter Tight", "Inter", "Martian Mono")
FORBIDDEN_PACKAGES = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "mysql", "mysql2",
                      "amqplib", "kafkajs", "nats", "@elastic/elasticsearch", "meilisearch", "memcached",
                      "isomorphic-git", "simple-git", "nodegit", "openai", "@anthropic-ai/sdk",
                      "@google/generative-ai", "langchain", "ollama"}
WORD = {"queued": "Queued", "in_progress": "In progress", "success": "Passed", "failure": "Failed", "timed_out": "Timed out"}

UNKNOWN_REVISION = "0123456789ab"
UPPER_HEX_REVISION = "ABCDEF123456"
JUNK_BRANCH = "bad branch"
ESCAPING_PATH = "../x"
ABSENT_PATH = "absent.txt"
NOT_TEXT_PATH = "bad.bin"
CRLF_PATH = "crlf.txt"
PLAIN_PATH = "plain.txt"
NESTED_PATH = "dir/b.txt"
QUEUE_PATH = "x{}.txt"
FAR_FUTURE = "2031-01-01T00:00:00"
ASSET_SUFFIXES = (".js", ".mjs", ".css")
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0")
ASSET_REF = re.compile(r"""(?:src|href)\s*=\s*["']?([^"'\s>]+)|["'`]([^"'`\s]+?\.(?:m?js|css)(?:\?[^"'`\s]*)?)["'`]|url\(\s*["']?([^"')\s]+)""")

WATCH_JS = """(marker) => {
  window.__anim = []; window.__max = 0;
  const note = (el) => { if (el.nodeType === 1 && el.hasAttribute(marker)) window.__anim.push([el.getAttribute(marker), el.getAttribute('data-anim')]); };
  new MutationObserver((records) => {
    for (const r of records) { note(r.target); r.addedNodes.forEach((n) => { note(n); if (n.querySelectorAll) n.querySelectorAll('[' + marker + ']').forEach(note); }); }
    window.__max = Math.max(window.__max, document.querySelectorAll('[data-anim="walking"]').length);
  }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-anim']});
}"""
LOOPS_JS = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
RUNNING_JS = "() => document.getAnimations().filter(a => a.playState === 'running').length"


def bkey(path):
    return path.encode()


def qp(i):
    return QUEUE_PATH.format(i)


def added(n, text):
    return f"Line {n}, added: {text}"


def removed(n, text):
    return f"Old line {n}, removed: {text}"


def unchanged(n, text):
    return f"Line {n}, unchanged: {text}"


def comment_dialog(path, n):
    return f"Comment on {path} line {n}"


def comment_button(n):
    return f"Comment on line {n}"


def thread_name(path, n):
    return f"Thread on {path} line {n}"


def rule_checks(*pairs):
    return "Required checks not passed: " + ", ".join(f"{n} ({WORD[s]})" for n, s in pairs)


def rule_approvals(required, current):
    return f"Needs {required} approvals, has {current}"


def rule_owners(paths):
    return "Needs code owner approval for " + ", ".join(sorted(paths, key=bkey))


def rule_changes(*names):
    return "Changes requested by " + ", ".join(names)


def ann_new_rev(n, rid, name, kept):
    return f"#{n}: new revision {rid} from {name}, approvals {'kept' if kept else 'dismissed'}"


def ann_restack(n, lower, kept):
    return f"#{n}: restacked onto #{lower}, approvals {'kept' if kept else 'dismissed'}"


def ann_conflict(n, count):
    return f"#{n}: restack conflict in {count} files"


def ann_not_restacked(n):
    return f"#{n}: not restacked"


def ann_position(n, p):
    return f"#{n}: queue position {p}"


def ann_reason(n, reason):
    return f"#{n}: {reason}"


def ann_merged(n):
    return f"#{n} merged"


def ann_comment(n, name):
    return f"#{n}: new comment from {name}"


def ann_check(n, name, state):
    return f"#{n}: check {name} {WORD[state]}"


def ann_review(n, name, verb):
    return f"#{n}: {name} {verb}"


def ann_dismissed(n, name):
    return f"#{n}: review by {name} dismissed"


def removed_failed(name):
    return f"Removed: check {name} failed"


def removed_timeout(name):
    return f"Removed: check {name} timed out"


def removed_conflict(*paths):
    return "Removed: conflicts with " + ", ".join(paths)


def word_dismissed(count):
    return f"Approvals dismissed ({count})"


def word_conflicts(count):
    return f"Conflicts in {count} files"


def notice_stopped(lower, *paths):
    return f"Restack stopped: {', '.join(paths)} changed in #{lower}"


def notice_not_restacked(n):
    return f"Not restacked: #{n} has a restack conflict"


def notice_base(branch_name, n):
    return f"Base changed to {branch_name} after #{n} merged"


def msg_apply(n):
    return "Apply 1 suggestion" if n == 1 else f"Apply {n} suggestions"


def msg_merge(n, title):
    return f"Merge #{n}: {title}"


def msg_queue(n, k):
    return f"Queue #{n} v{k}"


def msg_restack(lower):
    return f"Restack onto #{lower}"


def stale_suggestion(n):
    return f"This suggestion can no longer be applied: line {n} changed since it was made."


def stale_notice(branch_name):
    return f"This file changed on {branch_name} since you opened it. Your edit was not saved."


def queue_added(p):
    return f"Added to the merge queue at position {p}."


def queue_state(p):
    return f"In the merge queue, position {p}"


def merged_into(branch_name, rid):
    return f"Merged into {branch_name} as {rid}"


def dismissed_by(name, reason):
    return f"Dismissed by {name}: {reason}"


def need_field(field):
    return f"{field} is required"


def limit_msg(limit):
    return f"Request body exceeds {limit} bytes"


def position_range(count):
    return f"Position must be between 1 and {count}"


def not_utf8(path):
    return f"File {path} is not UTF-8 text"


def no_suggestion(cid):
    return f"Comment {cid} has no suggestion"


def not_found_user(username):
    return f"{username} was not found"


def subj_review(c, n, title):
    return f"[{c.org}/{c.repo}] Review requested on #{n}: {title}"


def subj_mention(c, n, name):
    return f"[{c.org}/{c.repo}] {name} mentioned you on #{n}"


def subj_merged(c, n, title):
    return f"[{c.org}/{c.repo}] #{n} merged: {title}"


def api(base, method, path, user=None, body=None, raw=None, token=None):
    headers = {}
    if user:
        headers["Cookie"] = f"{COOKIE}={user['cookie']}"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if raw is not None:
        headers["Content-Type"] = "application/json"
        return httpx.request(method, base + path, content=raw, headers=headers, timeout=HTTP_TIMEOUT)
    return httpx.request(method, base + path, json=body, headers=headers, timeout=HTTP_TIMEOUT)


def ok(r, status):
    assert r.status_code == status, f"{r.request.method} {r.request.url} answered {r.status_code} {r.text}"
    return r


def err(r, status, body):
    assert r.status_code == status and r.json() == body, f"{r.request.method} {r.request.url}: {r.status_code} {r.text}; expected {status} {body}"


def eventually(fn, what, seconds=POLL_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        threading.Event().wait(POLL_STEP)
    pytest.fail(f"expected within {seconds}s: {what}")


def settle_page(pg, ready, what, seconds=POLL_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if ready():
            return
        advance(pg, 100)
    pytest.fail(f"expected within {seconds}s: {what}")


def sized(total):
    base = len(json.dumps({"pad": ""}).encode())
    return json.dumps({"pad": "a" * (total - base)}).encode()


class Cast:
    def __init__(self, *labels):
        self.tag = uuid.uuid4().hex[:8]
        self.people = {l: {"username": f"{l}{self.tag}", "name": f"{l.title()} {self.tag}", "email": f"{l}{self.tag}@tests.example"} for l in labels}
        self.org, self.repo, self.team, self.side = (f"{p}{self.tag}" for p in "orts")

    def n(self, label):
        return self.people[label]["username"]

    def name(self, label):
        return self.people[label]["name"]


class World:
    def __init__(self, base, c, users, repo_id, keys, side_keys):
        self.base, self.c, self.users, self.repo_id, self.keys, self.side_keys = base, c, users, repo_id, keys, side_keys
        self.bodies = {}

    def path(self, tail=""):
        return f"/{self.c.org}/{self.c.repo}{tail}"

    def url(self, tail=""):
        return self.base + self.path(tail)

    def api(self, label, method, tail, body=None, raw=None):
        return api(self.base, method, f"/api/repos/{self.c.org}/{self.c.repo}{tail}", self.users[label] if label else None, body, raw)

    def num(self, key):
        return self.keys[key]["number"]


def S_push(who, key, branch, message, files, frm=None):
    p = {"branch": branch, "message": message, "files": files}
    if frm:
        p["from"] = frm
    return {"as": who, "key": key, "push": p}


def S_change(who, key, title, head, base="main", draft=False):
    return {"as": who, "key": key, "change": {"title": title, "head": head, "base": base, "draft": draft}}


def S_review(who, key, change, kind, summary="Reviewed"):
    return {"as": who, "key": key, "review": {"change": change, "type": kind, "summary": summary}}


def S_thread(who, key, change, path, line, body, suggestion=None, side="new"):
    t = {"change": change, "path": path, "side": side, "line": line, "end_line": line, "body": body}
    if suggestion:
        t["suggestion"] = suggestion
    return {"as": who, "key": key, "thread": t}


def S_check(who, key, revision, name, state):
    return {"as": who, "key": key, "check": {"revision": revision, "name": name, "state": state, "summary": "reported"}}


def S_queue(who, key, change):
    return {"as": who, "key": key, "queue": {"change": change}}


def make_world(base, c, steps, roles=None, settings=None, team=(), visibility="private", side=None):
    roles = {**{l: "writer" for l in c.people}, "owner": "owner", **(roles or {})}

    def translate(items):
        return [{**s, "as": c.n(s["as"])} for s in items]

    users = [{"email": p["email"], "username": p["username"], "name": p["name"], "password": PASSWORD} for p in c.people.values()]
    org = {"slug": c.org, "name": c.org, "owner": c.n("owner"), "members": [p["username"] for p in c.people.values()],
           "teams": [{"name": c.team, "members": [c.n(l) for l in team]}] if team else []}
    repos = [{"org": c.org, "name": c.repo, "visibility": visibility,
              "roles": [{"subject": f"user:{c.n(l)}", "role": r} for l, r in roles.items() if r],
              "settings": {**DEFAULT_SETTINGS, **(settings or {})}, "steps": translate(steps)}]
    if side:
        repos.append({"org": c.org, "name": c.side, "visibility": "private",
                      "roles": [{"subject": f"user:{c.n(l)}", "role": r} for l, r in side["roles"].items()],
                      "settings": DEFAULT_SETTINGS, "steps": translate(side["steps"])})
    r = post_json(base, "/api/grading/setup", {"users": users, "orgs": [org], "repos": repos}, **GK)
    assert r.status_code == 201, f"grading setup failed: {r.status_code} {r.text}"
    data = r.json()
    cooked = {l: {**p, "cookie": data["users"][p["username"]]["cookie"]} for l, p in c.people.items()}
    mine = data["repos"][f"{c.org}/{c.repo}"]
    other = data["repos"][f"{c.org}/{c.side}"]["keys"] if side else None
    return World(base, c, cooked, mine["id"], mine["keys"], other)


def diff_world(base, c, settings=None, extra=(), roles=None):
    steps = [S_push("dev", "base", "main", "Add a", {"a.txt": "l1\nl2\nl3\n"}),
             S_push("dev", "feat", "feat", "Edit", {"a.txt": "l1\nL2\nl3\n", "b.txt": "x\ny"}, frm="main"),
             S_change("dev", "c1", "Two files", "feat"), *extra]
    return make_world(base, c, steps, roles=roles, settings={"required_checks": ["lint"], **(settings or {})})


def stack_world(base, c, extra=(), settings=None):
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", "b.txt": "1\n", "c.txt": "1\n"}),
             S_push("dev", "p1", "feat1", "One", {"b.txt": "B1\n"}, frm="main"), S_change("dev", "c1", "One", "feat1"),
             S_push("dev", "p2", "feat2", "Two", {"a.txt": "2\n"}, frm="feat1"), S_change("dev", "c2", "Two", "feat2", "feat1"),
             S_push("dev", "p3", "feat3", "Three", {"c.txt": "C3\n"}, frm="feat2"), S_change("dev", "c3", "Three", "feat3", "feat2"),
             *extra]
    return make_world(base, c, steps, settings=settings)


def queue_world(base, c, n=3, queued=True, required=("unit",)):
    steps = [S_push("dev", "base", "main", "Base", {"base.txt": "b\n"})]
    for i in range(1, n + 1):
        steps += [S_push("dev", f"p{i}", f"q{i}", f"Add {qp(i)}", {qp(i): f"{qp(i)}\n"}, frm="main"), S_change("dev", f"c{i}", f"Entry {i}", f"q{i}")]
        steps += [S_check("dev", f"k{i}{name}", f"p{i}", name, "success") for name in required]
    if queued:
        steps += [S_queue("dev", f"e{i}", f"c{i}") for i in range(1, n + 1)]
    return make_world(base, c, steps, settings={"required_approvals": 0, "required_checks": list(required), "queue": True})


def push(w, label, branch, files, message="Update"):
    head = w.api(label, "GET", f"/branches/{branch}").json()["revision"]
    body = {"branch": branch, "expected_head": head, "message": message,
            "files": [{"path": p, "delete": True} if v is None else {"path": p, "content": v} for p, v in files.items()]}
    return ok(w.api(label, "POST", "/push", body), 201).json()


def change_json(w, label, n):
    return ok(w.api(label, "GET", f"/changes/{n}"), 200).json()


def rules_of(w, label, n):
    return {x["rule"]: x["text"] for x in change_json(w, label, n)["merge_rules"]}


def report(w, label, revision, name, state, summary="reported"):
    return ok(w.api(label, "POST", "/checks", {"revision": revision, "name": name, "state": state, "summary": summary}), 201)


def review_api(w, label, n, kind, summary="Reviewed"):
    return w.api(label, "POST", f"/changes/{n}/reviews", {"type": kind, "summary": summary})


def branch(w, label, name):
    return ok(w.api(label, "GET", f"/branches/{name}"), 200).json()["revision"]


def revision(w, label, rid):
    return ok(w.api(label, "GET", f"/revisions/{rid}"), 200).json()


def raw_file(w, label, rid, path):
    return ok(w.api(label, "GET", f"/revisions/{rid}/files/{path}"), 200).content


def queue_data(w, label="owner"):
    return ok(w.api(label, "GET", "/queue"), 200).json()


def entry_of(qd, entry_id):
    return next(e for e in qd["entries"] + qd["history"] if e["id"] == entry_id)


def clock(base, seconds):
    r = post_json(base, "/api/grading/clock", {"advance_seconds": seconds}, **GK)
    assert r.status_code == 200, r.text
    return r.json()


def iso(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def advance_to(base, target):
    delta = int((target - iso(clock(base, 0)["now"])).total_seconds())
    clock(base, max(delta, 0))


def in_order(blob, items):
    pos = -1
    for s in items:
        i = blob.find(s, pos + 1)
        assert i > pos, f"{s!r} missing or out of order in {blob!r}"
        pos = i


def wait_mails(mail, to_addr, part, count=1):
    def found():
        got = [m for m in mail.messages() if to_addr in addresses(m.get("To")) and part in (m.get("Subject") or "")]
        return got if len(got) >= count else None
    return eventually(found, f"mail to {to_addr} with subject containing {part!r} (x{count})")


def assert_change_mail(mail, m, cid, link):
    header = "X-Change-Id"
    assert mail_from_address() in addresses(m.get("From"))
    headers = {k.lower(): v for k, v in mail.client.get(f"/api/v1/message/{m['ID']}/headers").json().items()}
    assert [v.strip() for v in headers.get(header.lower(), [])] == [cid], f"{header} header: {headers.get(header.lower())}"
    assert link in mail_text(m)


def down_login(down, c, label):
    r = ok(api(down, "POST", "/api/login", body={"email": c.people[label]["email"], "password": PASSWORD}), 200)
    return {label: {"cookie": re.search(rf"{COOKIE}=([^;]+)", r.headers["set-cookie"]).group(1)}}


@contextmanager
def as_user(browser, w, label, size=WIDE, reduced="no-preference", base=None, users=None):
    target = base or w.base
    with open_app(browser, target, reduced_motion=reduced) as pg:
        pg.set_viewport_size(size)
        if label:
            pg.context.add_cookies([{"name": COOKIE, "value": (users or w.users)[label]["cookie"], "url": target}])
        yield pg


def row(pg, path, name):
    return pg.get_by_role("table", name=f"Diff of {path}").get_by_role("row", name=name, exact=True)


def merge_box(pg):
    return pg.get_by_role("region", name="Merge box")


def rule_items(pg):
    return merge_box(pg).get_by_role("list", name="Merge rules").get_by_role("listitem")


def updates(pg):
    return pg.get_by_role("status", name="Review updates")


def action(pg):
    return pg.get_by_role("status", name="Action status")


def stack_row(pg, n):
    return pg.get_by_role("list", name="Stack").get_by_role("listitem").filter(has=pg.get_by_role("link", name=re.compile(rf"^#{n} ")))


def thread(pg, path, line):
    return pg.get_by_role("article", name=thread_name(path, line))


def check_item(pg, name):
    return pg.get_by_role("list", name="Checks").get_by_role("listitem").filter(has_text=name)


def qentry(pg, n):
    return pg.get_by_role("list", name="Queue entries").get_by_role("listitem").filter(has=pg.get_by_role("link", name=re.compile(rf"^#{n} ")))


def open_change(pg, w, n=1, unified=True):
    pg.goto(w.url(f"/changes/{n}"))
    soon(merge_box(pg), ACT_MS).to_be_visible()
    soon(pg.get_by_role("table", name=re.compile(r"^Diff of ")).first, ACT_MS).to_be_visible()
    if unified and pg.get_by_role("radio", name="Unified").count():
        turn_on(pg.get_by_role("radio", name="Unified"))
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")


TARGET_JS = """(e) => {
  e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  const at = el => { const b = el.getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; };
  const hits = (el, p) => { const h = document.elementFromPoint(p.x, p.y); return h === el || el.contains(h); };
  const p = at(e);
  if (hits(e, p)) return p;
  const label = (e.labels && e.labels[0]) || e.closest('label');
  if (label) { const q = at(label); if (hits(label, q)) return q; }
  return null;
}"""


def turn_on(control, touch=False):
    soon(control).to_be_enabled()
    if not control.is_checked():
        point = control.evaluate(TARGET_JS)
        assert point is not None, "control is obscured at the actual pointer target"
        (control.page.touchscreen.tap if touch else control.page.mouse.click)(point["x"], point["y"])
    soon(control).to_be_checked()


GLOW_JS = """(e) => [null, '::before', '::after'].map(pseudo => {
  const s = getComputedStyle(e, pseudo);
  if (pseudo && (s.content === 'none' || s.content === 'normal')) return null;
  return {shadow: s.boxShadow, filter: s.filter, image: s.backgroundImage, colour: s.backgroundColor,
          border: s.borderColor, opacity: s.opacity};
})"""


def glow_layers(locator, state=None):
    locator.page.mouse.move(0, 0)
    if state == "hover":
        ready(locator).hover()
    settle(locator)
    return locator.evaluate(GLOW_JS)


def has_halo(layers):
    return any(l and (l["shadow"] != "none" or l["filter"] not in ("none", "")) for l in layers)


RING_JS = """(e) => [e, e.parentElement].map(el => { const s = getComputedStyle(el);
  return [s.outlineStyle, s.outlineColor, s.boxShadow, s.borderColor, s.borderImageSource, s.backgroundImage].join('|'); })"""


def watch(pg, marker):
    pg.evaluate(WATCH_JS, marker)


def anim_seen(pg):
    return {a for _, a in pg.evaluate("() => window.__anim")}


def walked_rows(pg, last):
    def rows():
        seen = []
        for n, a in pg.evaluate("() => window.__anim"):
            if a == "walking" and n not in seen:
                seen.append(n)
        return seen

    eventually(lambda: str(last) in rows(), f"rail row {last} walks")
    soon(stack_row(pg, last), ACT_MS).to_have_attribute("data-anim", "none")
    return rows()


def inside(dlg):
    return dlg.evaluate("el => el.contains(document.activeElement)")


def trap(pg, dlg):
    for key in ("Tab", "Shift+Tab"):
        for _ in range(10):
            pg.keyboard.press(key)
            assert inside(dlg), f"{key} left the dialog"


def attr(locator, name):
    return locator.evaluate("(el, n) => el.getAttribute(n) || ''", name)


def revision_id(parents, message, files):
    out = b"".join(b"parent " + p.encode() + b"\n" for p in parents)
    m = message.encode()
    out += b"message " + str(len(m)).encode() + b"\n" + m + b"\n"
    for path in sorted(files, key=bkey):
        out += b"file " + str(len(files[path])).encode() + b" " + path.encode() + b"\n" + files[path] + b"\n"
    return hashlib.sha256(out).hexdigest()[:12]


def small_controls(pg):
    bad = []
    for b in pg.get_by_role("button").all():
        box = b.bounding_box() if b.is_visible() else None
        if box and (box["height"] < TAP_MIN_PX or box["width"] < TAP_MIN_PX):
            bad.append((b.inner_text()[:30], box))
    return bad


def test_wf_keyboard_review_cursor(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    order = [("a.txt", unchanged(1, "l1")), ("a.txt", removed(2, "l2")), ("a.txt", added(2, "L2")),
             ("a.txt", unchanged(3, "l3")), ("b.txt", added(1, "x")), ("b.txt", added(2, "y"))]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        soon(row(pg, "a.txt", "@@ -1,3 +1,3 @@")).to_be_visible()
        pg.keyboard.press("j")
        for i, (path, name) in enumerate(order):
            if i:
                pg.keyboard.press("ArrowDown")
            soon(row(pg, path, name)).to_have_attribute("data-cursor", "true")
            soon(row(pg, path, name)).to_be_focused()
        pg.keyboard.press("ArrowDown")
        soon(row(pg, "b.txt", added(2, "y"))).to_be_focused()
        pg.keyboard.press("k")
        soon(row(pg, "a.txt", unchanged(1, "l1"))).to_be_focused()
        pg.keyboard.press("ArrowUp")
        soon(row(pg, "a.txt", unchanged(1, "l1"))).to_be_focused()
        pg.keyboard.press("j")
        soon(row(pg, "b.txt", added(1, "x"))).to_be_focused()
        pg.keyboard.press("j")
        soon(row(pg, "b.txt", added(1, "x"))).to_be_focused()
        ready(pg.get_by_role("checkbox", name="Viewed").first).focus()
        pg.keyboard.press("k")
        soon(row(pg, "a.txt", unchanged(1, "l1"))).to_be_focused()


def test_wf_keyboard_review_dialog(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    typed = f"rename-{c.tag}"
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown"):
            pg.keyboard.press(key)
        cursor = row(pg, "a.txt", added(2, "L2"))
        soon(cursor).to_have_attribute("data-cursor", "true")
        pg.keyboard.press("c")
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        soon(dlg).to_be_visible()
        box = dlg.get_by_role("textbox", name="Comment", exact=True)
        soon(box).to_be_focused()
        names = tab_order(pg, 8)
        assert {"Add comment", "Cancel"} <= set(names), names
        trap(pg, dlg)
        fill(box, typed)
        pg.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(thread(pg, "a.txt", 2), ACT_MS).to_be_visible()
        soon(action(pg)).to_contain_text("Comment added.")
        soon(cursor).to_be_focused()
        pg.keyboard.press("c")
        soon(dlg).to_be_visible()
        fill(box, f"unsaved-{c.tag}")
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(pg.locator("[data-thread-id]")).to_have_count(1)


def test_wf_keyboard_review_request_changes(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        open_change(author, w)
        open_change(rev, w)
        rev.keyboard.press("r")
        dlg = rev.get_by_role("dialog", name="Submit review")
        soon(dlg).to_be_visible()
        soon(dlg.get_by_role("radio").first).to_be_focused()
        turn_on(dlg.get_by_role("radio", name="Request changes"))
        click(dlg.get_by_role("button", name="Submit review"))
        soon(dlg.get_by_role("alert")).to_contain_text("A summary is required to request changes")
        fill(dlg.get_by_role("textbox", name="Review summary"), f"summary-{c.tag}")
        rev.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        item = rule_items(author).filter(has_text=rule_changes(c.name("rev")))
        soon(item, LIVE_MS).to_have_count(1)
        soon(item).to_have_attribute("data-rule", "changes-requested")
        soon(updates(author), LIVE_MS).to_contain_text(ann_review(1, c.name("rev"), "requested changes"))
    assert change_json(w, "dev", 1)["changes_requested"] is True


def test_wf_keyboard_review_checks_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(rule_items(pg).filter(has_text=rule_checks(("lint", "queued")))).to_have_count(1)
        report(w, "dev", head, "lint", "failure")
        soon(rule_items(pg).filter(has_text=rule_checks(("lint", "failure"))), LIVE_MS).to_have_count(1)
        report(w, "dev", head, "lint", "success")
        soon(rule_items(pg).filter(has_text="Required checks not passed"), LIVE_MS).to_have_count(0)
        soon(check_item(pg, "lint")).to_have_attribute("data-state", "success")
        soon(check_item(pg, "lint")).to_contain_text(WORD["success"])
    assert "checks" not in rules_of(w, "dev", 1)


def sugg_world(base, c):
    bodies = {k: f"{k}-{c.tag}" for k in ("one", "two", "three")}
    steps = [S_push("dev", "base", "main", "Add f", {"f.txt": "one\ntwo\nthree\nfour\nfive\n"}),
             S_push("dev", "feat", "feat", "Edit f", {"f.txt": "one\nTWO\nthree\nfour\nfive\n"}, frm="main"),
             S_change("dev", "c1", "Suggest", "feat"),
             S_thread("rev", "t1", "c1", "f.txt", 3, bodies["one"], ["THREE"]),
             S_thread("rev", "t2", "c1", "f.txt", 4, bodies["two"], ["FOUR a", "FOUR b"]),
             S_thread("rev", "t3", "c1", "f.txt", 5, bodies["three"], ["FIVE"])]
    w = make_world(base, c, steps)
    w.bodies = bodies
    return w


def test_wf_suggestion_batch_controls(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown", "c"):
            pg.keyboard.press(key)
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        fill(dlg.get_by_role("textbox", name="Comment", exact=True), f"wording-{c.tag}")
        turn_on(dlg.get_by_role("checkbox", name="Add a suggestion"))
        fill(dlg.get_by_role("textbox", name="Suggested lines"), f"reworded-{c.tag}")
        pg.keyboard.press("Control+Enter")
        soon(thread(pg, "a.txt", 2), ACT_MS).to_be_visible()
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        region = thread(pg, "a.txt", 2).get_by_role("region", name="Suggested change")
        soon(region.get_by_role("button", name="Apply suggestion"), ACT_MS).to_be_visible()
        soon(region.get_by_role("button", name="Add to batch")).to_be_visible()
    body = {"path": "a.txt", "side": "new", "line": 1, "end_line": 2, "body": f"range-{c.tag}", "suggestion": {"lines": ["p", "q", "r"]}}
    t = ok(w.api("rev", "POST", "/changes/1/threads", body), 201).json()
    assert (t["line"], t["end_line"]) == (1, 2)
    assert t["comments"][0]["suggestion"] == {"lines": ["p", "q", "r"], "state": "open"}
    err(w.api("rev", "POST", "/changes/1/threads", {**body, "side": "old", "line": 2, "end_line": 2}), 422,
        {"errors": {"suggestion": "Suggestions are only possible on new lines"}})


def test_wf_suggestion_batch_apply(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = sugg_world(app_url, c)
    head0 = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        arts = {k: pg.locator("[data-thread-id]").filter(has_text=w.bodies[k]) for k in ("one", "two", "three")}
        for k in ("one", "two"):
            click(arts[k].get_by_role("region", name="Suggested change").get_by_role("button", name="Add to batch"))
            soon(arts[k].get_by_role("button", name="Remove from batch")).to_be_visible()
        click(pg.get_by_role("button", name="Apply batch"))
        soon(action(pg), ACT_MS).to_contain_text("Suggestions applied in revision ")
        rev1 = re.search(r"revision ([0-9a-f]{12})\.", action(pg).inner_text()).group(1)
        assert change_json(w, "dev", 1)["head_revision"] == rev1
        r1 = revision(w, "dev", rev1)
        assert r1["message"] == msg_apply(2) and r1["parents"] == [head0]
        assert raw_file(w, "dev", rev1, "f.txt") == b"one\nTWO\nTHREE\nFOUR a\nFOUR b\nfive\n"
        soon(row(pg, "f.txt", added(3, "THREE")), LIVE_MS).to_be_visible()
        soon(row(pg, "f.txt", added(5, "FOUR b"))).to_be_visible()
        turn_on(pg.get_by_role("switch", name="Show outdated threads"))
        applied = pg.get_by_role("region", name="Outdated threads").locator("[data-thread-id]").filter(has_text=w.bodies["one"])
        soon(applied.get_by_text("Applied"), LIVE_MS).to_be_visible()
        click(arts["three"].get_by_role("region", name="Suggested change").get_by_role("button", name="Apply suggestion"))
        soon(action(pg), ACT_MS).to_have_text(re.compile(rf"revision (?!{rev1})[0-9a-f]{{12}}\."))
    head2 = change_json(w, "dev", 1)["head_revision"]
    r2 = revision(w, "dev", head2)
    assert r2["message"] == msg_apply(1) and r2["parents"] == [rev1]
    assert raw_file(w, "dev", head2, "f.txt") == b"one\nTWO\nTHREE\nFOUR a\nFOUR b\nFIVE\n"


def test_wf_suggestion_batch_stale(app_url):
    c = Cast("owner", "dev", "rev")
    w = sugg_world(app_url, c)
    t1, t2 = w.keys["t1"]["comment"], w.keys["t2"]["comment"]
    apply = lambda who, ids: w.api(who, "POST", "/changes/1/suggestions/apply", {"comments": ids})
    err(apply("rev", [t1]), 403, {"error": "Only the change author or a maintainer can apply suggestions"})
    push(w, "dev", "feat", {"f.txt": "one\nTWO\nthree changed\nfour\nfive\n"})
    head = change_json(w, "dev", 1)["head_revision"]
    err(apply("dev", [t1, t2]), 409, {"error": stale_suggestion(3)})
    assert change_json(w, "dev", 1)["head_revision"] == head
    plain = ok(w.api("rev", "POST", f"/changes/1/threads/{w.keys['t1']['id']}/replies", {"body": f"plain-{c.tag}"}), 201).json()["id"]
    err(apply("dev", [plain]), 422, {"errors": {"comments": no_suggestion(plain)}})
    r = ok(apply("dev", [t2]), 201).json()
    assert r["message"] == msg_apply(1)
    assert raw_file(w, "dev", r["revision"], "f.txt") == b"one\nTWO\nthree changed\nFOUR a\nFOUR b\nfive\n"
    err(apply("dev", [t2]), 409, {"error": "This suggestion was already applied"})


def test_wf_suggestion_batch_live_comment(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    for reduced in (False, True):
        with as_user(browser, w, "dev", **({"reduced": "reduce"} if reduced else {})) as pg:
            open_change(pg, w)
            watch(pg, "data-thread-id")
            body = f"live-{reduced}-{c.tag}"
            ok(w.api("rev", "POST", "/changes/1/threads", {"path": "a.txt", "side": "new", "line": 3, "end_line": 3, "body": body}), 201)
            art = pg.locator("[data-thread-id]").filter(has_text=body)
            soon(art, LIVE_MS).to_have_count(1)
            soon(updates(pg), LIVE_MS).to_contain_text(ann_comment(1, c.name("rev")))
            soon(art, ACT_MS).to_have_attribute("data-anim", "none")
            seen = anim_seen(pg)
            assert ("entering" in seen) == (not reduced), seen


def approval_world(base, c, extra=()):
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", "b.txt": "1\n"}),
             S_push("dev", "feat", "feat", "Edit", {"a.txt": "2\n", "b.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "Approve me", "feat"), S_review("rev", "r1", "c1", "approve"), *extra]
    return make_world(base, c, steps)


def test_wf_push_dismisses_approval(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = approval_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        review = pg.get_by_role("list", name="Reviews").get_by_role("listitem").first
        soon(review).to_have_attribute("data-state", "approved")
        same = push(w, "dev", "feat", {"a.txt": "2\n"}, "Same content")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, same["revision"], c.name("dev"), True))
        soon(review).to_have_attribute("data-state", "approved")
        assert "approvals" not in rules_of(w, "dev", 1)
        moved = push(w, "dev", "feat", {"a.txt": "3\n"}, "Moves the diff")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, moved["revision"], c.name("dev"), False))
        soon(review).to_have_attribute("data-state", "dismissed")
        soon(review).to_contain_text("Dismissed: the change was updated after this approval")
        soon(rule_items(pg).filter(has_text=rule_approvals(1, 0)), LIVE_MS).to_have_count(1)
        push(w, "dev", "feat", {"a.txt": "2\n"}, "Back to approved diff")
        soon(review).to_have_attribute("data-state", "dismissed")
    assert rules_of(w, "dev", 1)["approvals"] == rule_approvals(1, 0)


def test_wf_push_dismisses_threads(browser, app_url):
    c = Cast("owner", "dev", "rev")
    body_b, body_c = f"moved-{c.tag}", f"changed-{c.tag}"
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "a\nb\nc\nd\n"}),
             S_push("dev", "feat", "feat", "Edit", {"a.txt": "a\nb\nc\nd\ne\n"}, frm="main"),
             S_change("dev", "c1", "Threads", "feat"),
             S_thread("rev", "tb", "c1", "a.txt", 2, body_b), S_thread("rev", "tc", "c1", "a.txt", 3, body_c),
             S_push("dev", "p2", "feat", "Insert x", {"a.txt": "a\nx\nb\nc\nd\ne\n"}),
             S_push("dev", "p3", "feat", "Change c", {"a.txt": "a\nx\nb\nC\nd\ne\n"})]
    w = make_world(app_url, c, steps)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        moved = thread(pg, "a.txt", 3)
        soon(moved).to_have_attribute("data-thread-id", str(w.keys["tb"]["id"]))
        soon(moved).to_have_attribute("data-outdated", "false")
        soon(thread(pg, "a.txt", 4)).to_have_count(0)
        soon(pg.get_by_text("Unresolved threads: 2")).to_be_visible()
        turn_on(pg.get_by_role("switch", name="Show outdated threads"))
        old = pg.get_by_role("region", name="Outdated threads").get_by_role("article", name=thread_name("a.txt", 4))
        soon(old).to_have_attribute("data-thread-id", str(w.keys["tc"]["id"]))
        soon(old).to_have_attribute("data-outdated", "true")
        soon(old).to_contain_text(body_c)


def test_wf_push_dismisses_counts(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = approval_world(app_url, c, [S_thread("rev", "t1", "c1", "a.txt", 1, f"count-{c.tag}")])
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        soon(pg.get_by_text("0 of 2 files viewed")).to_be_visible()
        soon(pg.get_by_text("Unresolved threads: 1")).to_be_visible()
        soon(pg.get_by_text("Approvals remaining: 0")).to_be_visible()
        boxes = pg.get_by_role("checkbox", name="Viewed")
        turn_on(boxes.nth(0))
        turn_on(boxes.nth(1))
        soon(pg.get_by_text("2 of 2 files viewed")).to_be_visible()
        assert change_json(w, "rev", 1)["counts"]["files_viewed"] == 2
        push(w, "dev", "feat", {"a.txt": "9\n"})
        soon(pg.get_by_text("1 of 2 files viewed"), LIVE_MS).to_be_visible()
        soon(pg.get_by_text("Approvals remaining: 1"), LIVE_MS).to_be_visible()
        soon(boxes.nth(0)).not_to_be_checked()
        soon(boxes.nth(1)).to_be_checked()
        push(w, "dev", "feat", {"a.txt": "9\n"}, "Message only")
        soon(pg.get_by_text("1 of 2 files viewed")).to_be_visible()
        ok(w.api("rev", "PUT", f"/changes/1/threads/{w.keys['t1']['id']}/state", {"state": "resolved"}), 200)
        soon(pg.get_by_text("Unresolved threads: 0"), LIVE_MS).to_be_visible()
        ok(review_api(w, "rev", 1, "approve"), 201)
        soon(pg.get_by_text("Approvals remaining: 0"), LIVE_MS).to_be_visible()
        push(w, "dev", "feat", {"a.txt": "8\n"})
        soon(pg.get_by_text("Approvals remaining: 1"), LIVE_MS).to_be_visible()
    assert change_json(w, "rev", 1)["counts"] == {"files_viewed": 1, "files_total": 2, "unresolved_threads": 0, "approvals_remaining": 1}


def test_wf_push_dismisses_keys(browser, app_url):
    c = Cast("owner", "dev", "rev")
    first, second, done = (f"{k}-{c.tag}" for k in ("first", "second", "done"))
    w = diff_world(app_url, c, extra=[S_thread("rev", "t1", "c1", "a.txt", 2, first), S_thread("rev", "t3", "c1", "a.txt", 3, done),
                                      S_thread("rev", "t2", "c1", "b.txt", 1, second)])
    ok(w.api("rev", "PUT", f"/changes/1/threads/{w.keys['t3']['id']}/state", {"state": "resolved"}), 200)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        pg.keyboard.press("n")
        soon(pg.locator("[data-thread-id]").filter(has_text=first)).to_be_focused()
        soon(row(pg, "a.txt", added(2, "L2"))).to_have_attribute("data-cursor", "true")
        pg.keyboard.press("n")
        soon(pg.locator("[data-thread-id]").filter(has_text=second)).to_be_focused()
        soon(row(pg, "b.txt", added(1, "x"))).to_have_attribute("data-cursor", "true")
        pg.keyboard.press("p")
        soon(pg.locator("[data-thread-id]").filter(has_text=first)).to_be_focused()
        pg.keyboard.press("v")
        soon(pg.get_by_text("1 of 2 files viewed"), LIVE_MS).to_be_visible()
        pg.keyboard.press("v")
        soon(pg.get_by_text("0 of 2 files viewed"), LIVE_MS).to_be_visible()


def test_wf_restack_keeps_approval_revisions(app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    old = {n: change_json(w, "dev", n)["head_revision"] for n in (1, 2, 3)}
    pushed = push(w, "dev", "feat1", {"b.txt": "9\n"})["revision"]
    for n, lower in ((2, 1), (3, 2)):
        ch = change_json(w, "dev", n)
        assert ch["head_revision"] != old[n]
        rv = revision(w, "dev", ch["head_revision"])
        assert rv["message"] == msg_restack(lower) and rv["parents"] == [old[n]]
        assert ch["base_revision"] == change_json(w, "dev", lower)["head_revision"]
        assert revision(w, "dev", old[n])["id"] == old[n]
    assert change_json(w, "dev", 1)["head_revision"] == pushed
    assert raw_file(w, "dev", change_json(w, "dev", 2)["head_revision"], "a.txt") == b"2\n"
    assert raw_file(w, "dev", change_json(w, "dev", 2)["head_revision"], "b.txt") == b"9\n"
    assert raw_file(w, "dev", change_json(w, "dev", 3)["head_revision"], "c.txt") == b"C3\n"


def test_wf_restack_keeps_approval_kept(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, [S_review("rev", "r2", "c2", "approve"), {"as": "rev", "key": "v2", "viewed": {"change": "c2", "path": "a.txt"}}])
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 2)
        review = pg.get_by_role("list", name="Reviews").get_by_role("listitem").first
        push(w, "dev", "feat1", {"b.txt": "9\n"})
        soon(stack_row(pg, 2), ACT_MS).to_have_attribute("data-restack", "kept")
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        soon(review).to_have_attribute("data-state", "approved")
        soon(updates(pg)).to_contain_text(ann_restack(2, 1, True))
        assert change_json(w, "rev", 2)["counts"]["files_viewed"] == 1 and "approvals" not in rules_of(w, "rev", 2)
        push(w, "dev", "feat1", {"a.txt": "2\n"})
        soon(stack_row(pg, 2), ACT_MS).to_have_attribute("data-restack", "dismissed")
        soon(stack_row(pg, 2)).to_contain_text(word_dismissed(1))
        soon(review).to_have_attribute("data-state", "dismissed")
        soon(updates(pg)).to_contain_text(ann_restack(2, 1, False))
    assert "approvals" in rules_of(w, "rev", 2)


def test_wf_restack_keeps_approval_conflict(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    h2, h3 = (change_json(w, "dev", n)["head_revision"] for n in (2, 3))
    push(w, "dev", "feat1", {"a.txt": "3\n"})
    c2, c3 = change_json(w, "dev", 2), change_json(w, "dev", 3)
    assert c2["restack"]["result"] == "conflicting" and c2["restack"]["notice"] == notice_stopped(1, "a.txt")
    assert c3["restack"]["result"] == "not_restacked" and c3["restack"]["notice"] == notice_not_restacked(2)
    assert (c2["head_revision"], c3["head_revision"]) == (h2, h3)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 3)
        soon(stack_row(pg, 2)).to_contain_text(word_conflicts(1))
        soon(stack_row(pg, 3)).to_contain_text("Not restacked")
        soon(pg.get_by_role("region", name="Change notices").get_by_role("listitem")).to_have_attribute("data-notice", "not-restacked")
    fix = push(w, "dev", "feat2", {"a.txt": "3\n"}, "Take a from #1")
    c2 = change_json(w, "dev", 2)
    top = revision(w, "dev", c2["head_revision"])
    assert top["message"] == msg_restack(1) and top["parents"] == [fix["revision"]]
    assert revision(w, "dev", fix["revision"])["parents"] == [h2]
    assert c2["restack"]["result"] == "dismissed"
    assert revision(w, "dev", change_json(w, "dev", 3)["head_revision"])["message"] == msg_restack(2)


def test_wf_restack_keeps_approval_announced(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 3)
        pushed = push(w, "dev", "feat1", {"b.txt": "9\n"})["revision"]
        soon(updates(pg), ACT_MS).to_contain_text(ann_restack(3, 2, True))
        in_order(updates(pg).text_content(), [f"#1: new revision {pushed} from {c.name('dev')}, approvals ", ann_restack(2, 1, True), ann_restack(3, 2, True)])
    c2 = Cast("owner", "dev", "rev")
    w2 = stack_world(app_url, c2)
    with as_user(browser, w2, "rev") as pg:
        open_change(pg, w2, 3)
        push(w2, "dev", "feat1", {"a.txt": "3\n"})
        soon(updates(pg), ACT_MS).to_contain_text(ann_not_restacked(3))
        in_order(updates(pg).text_content(), ["#1: new revision ", ann_conflict(2, 1), ann_not_restacked(3)])


ALL_OWNED = ["main.ts", "README.md", "src/ledger.ts", "src/rates.ts", "src/docs/a.md", "docs/guide.md", "vendor/x.js"]


def owners_world(base, c, owners, files, team=("tomas",)):
    steps = [S_push("dev", "base", "main", "Base", {".review/OWNERS": owners, "seed.txt": "s\n"}),
             S_push("dev", "feat", "feat", "Add files", files, frm="main"), S_change("dev", "c1", "Owned", "feat")]
    return make_world(base, c, steps, settings={"required_approvals": 0}, team=team)


def owners_cast():
    return Cast("owner", "dev", "mira", "tomas", "priya", "jonas", "lena", "ext")


def owners_text(c):
    return (f"* @{c.n('mira')}\n/src/ @{c.org}/{c.team}\n*.md @{c.n('priya')}\n/src/rates.ts @{c.n('tomas')} @{c.n('jonas')}\n"
            f"docs/** @{c.n('lena')}\n/vendor/\n")


def test_wf_code_owners_matching(app_url):
    c = owners_cast()
    w = owners_world(app_url, c, owners_text(c), {p: "x\n" for p in ALL_OWNED})
    paths = [p for p in ALL_OWNED if p != "vendor/x.js"]
    assert rules_of(w, "dev", 1)["code-owners"] == rule_owners(paths)
    ok(review_api(w, "jonas", 1, "approve"), 201)
    paths.remove("src/rates.ts")
    assert rules_of(w, "dev", 1)["code-owners"] == rule_owners(paths)
    ok(review_api(w, "lena", 1, "approve"), 201)
    paths.remove("docs/guide.md")
    assert rules_of(w, "dev", 1)["code-owners"] == rule_owners(paths)
    assert "README.md" in rules_of(w, "dev", 1)["code-owners"]


def test_wf_code_owners_merge_box(app_url):
    c = owners_cast()
    w = owners_world(app_url, c, owners_text(c), {p: "x\n" for p in ALL_OWNED})
    left = ["README.md", "docs/guide.md", "main.ts", "src/docs/a.md", "src/ledger.ts", "src/rates.ts"]
    ok(review_api(w, "ext", 1, "approve"), 201)
    assert rules_of(w, "dev", 1)["code-owners"] == rule_owners(left)
    for who, gone in (("priya", ["README.md", "src/docs/a.md"]), ("tomas", ["src/ledger.ts", "src/rates.ts"]), ("mira", ["main.ts"])):
        ok(review_api(w, who, 1, "approve"), 201)
        left = [p for p in left if p not in gone]
        assert rules_of(w, "dev", 1)["code-owners"] == rule_owners(left)
    ok(review_api(w, "lena", 1, "approve"), 201)
    assert "code-owners" not in rules_of(w, "dev", 1)


def test_wf_code_owners_base_file(app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n", {".review/OWNERS": f"* @{c.n('lena')}\n", "x.txt": "x\n"}, team=())
    want = rule_owners([".review/OWNERS", "x.txt"])
    assert rules_of(w, "dev", 1)["code-owners"] == want
    ok(review_api(w, "lena", 1, "approve"), 201)
    assert rules_of(w, "dev", 1)["code-owners"] == want
    ok(review_api(w, "mira", 1, "approve"), 201)
    assert "code-owners" not in rules_of(w, "dev", 1)


def test_wf_code_owners_journey(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n/src/ @{c.org}/{c.team}\n", {"main.ts": "m\n", "src/ledger.ts": "l\n"})
    with as_user(browser, w, "dev") as author, as_user(browser, w, "mira") as mira:
        open_change(author, w)
        open_change(mira, w)
        soon(rule_items(author).filter(has_text=rule_owners(["main.ts", "src/ledger.ts"]))).to_have_count(1)
        soon(merge_box(author).get_by_role("button", name="Merge change")).to_be_disabled()
        mira.keyboard.press("r")
        dlg = mira.get_by_role("dialog", name="Submit review")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"mine-{c.tag}")
        mira.keyboard.press("Control+Enter")
        soon(rule_items(author).filter(has_text=rule_owners(["src/ledger.ts"])), LIVE_MS).to_have_count(1)
        ok(review_api(w, "tomas", 1, "approve"), 201)
        soon(rule_items(author).first, LIVE_MS).to_have_attribute("data-rule", "met")
        soon(rule_items(author).first).to_have_text("All merge rules are met")
        soon(merge_box(author).get_by_role("button", name="Merge change")).to_be_enabled()
    assert "code-owners" not in rules_of(w, "dev", 1)


def check_world(base, c, required=("lint",)):
    return diff_world(base, c, settings={"required_approvals": 0, "required_checks": list(required)})


def test_wf_check_lifecycle_reports(app_url):
    c = Cast("owner", "dev", "rev", "rdr", "out")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "B", {"a.txt": "1\n"}), S_push("dev", "feat", "feat", "E", {"a.txt": "2\n"}, frm="main"),
                                S_change("dev", "c1", "T", "feat")], roles={"rdr": "reader", "out": None},
                   settings={"required_approvals": 0, "required_checks": ["lint"]})
    head = change_json(w, "dev", 1)["head_revision"]
    good = {"revision": head, "name": "lint", "state": "success", "summary": "ok"}
    for state in ("queued", "in_progress", "failure", "success"):
        r = ok(w.api("dev", "POST", "/checks", {**good, "state": state}), 201)
        assert r.json() == {"revision": head, "name": "lint", "state": state}
        if state == "failure":
            assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "failure"))
    assert "checks" not in rules_of(w, "dev", 1)
    bad = [({**good, "state": "done"}, {"state": "State must be one of queued, in_progress, success, failure"}),
           ({**good, "name": ""}, {"name": "Name is required"}), ({**good, "name": "n" * 65}, {"name": "Name must be 1 to 64 characters"}),
           ({**good, "revision": UPPER_HEX_REVISION}, {"revision": "Revision must be 12 hex characters"}),
           ({**good, "summary": "s" * 1001}, {"summary": "Summary must be at most 1000 characters"})]
    for body, errors in bad:
        err(w.api("dev", "POST", "/checks", body), 422, {"errors": errors})
    err(w.api("dev", "POST", "/checks", {**good, "revision": UNKNOWN_REVISION}), 404, {"error": "Not found"})
    err(w.api("rdr", "POST", "/checks", good), 403, {"error": "You need write access to do that"})
    err(w.api("out", "POST", "/checks", good), 404, {"error": "Not found"})
    err(w.api(None, "POST", "/checks", good), 401, {"error": "Authentication required"})
    err(w.api("dev", "POST", "/checks", raw=sized(PUSH_LIMIT + 1)), 413, {"error": limit_msg(PUSH_LIMIT)})
    assert w.api("dev", "POST", "/checks", raw=sized(PUSH_LIMIT)).status_code != 413
    assert "checks" not in rules_of(w, "dev", 1)


def test_wf_check_lifecycle_tokens(app_url):
    c = Cast("owner", "dev", "rev")
    names = {k: f"{k}{c.tag}" for k in ("wr", "rd", "sd")}
    tok = lambda key, name, access: {"as": "dev", "key": key, "token": {"name": name, "access": access}}
    side = {"roles": {"dev": "owner"}, "steps": [S_push("dev", "sb", "main", "S", {"s.txt": "s\n"}), tok("st", names["sd"], "write")]}
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n"}), S_push("dev", "feat", "feat", "E", {"a.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "T", "feat"), tok("tw", names["wr"], "write"), tok("tr", names["rd"], "read")]
    w = make_world(app_url, c, steps, settings={"required_approvals": 0, "required_checks": ["lint"]}, side=side)
    write, read, other = w.keys["tw"], w.keys["tr"], w.side_keys["st"]
    base = f"/api/repos/{c.org}/{c.repo}"
    head = change_json(w, "dev", 1)["head_revision"]
    main = branch(w, "dev", "main")
    new = {"branch": f"tok{c.tag}", "expected_head": None, "from": "main", "message": "By token", "files": [{"path": "t.txt", "content": "t\n"}]}
    done = ok(api(app_url, "POST", base + "/push", body=new, token=write["token"]), 201).json()
    assert revision(w, "dev", done["revision"])["author"] == f"token:{names['wr']}"
    good = {"revision": head, "name": "lint", "state": "success", "summary": "ok"}
    assert ok(api(app_url, "POST", base + "/checks", body=good, token=write["token"]), 201).json() == {"revision": head, "name": "lint", "state": "success"}
    assert "checks" not in rules_of(w, "dev", 1)
    assert ok(api(app_url, "GET", base + "/branches/main", token=read["token"]), 200).json()["revision"] == main
    deny = {"error": "You need write access to do that"}
    err(api(app_url, "POST", base + "/push", body={**new, "branch": f"rd{c.tag}"}, token=read["token"]), 403, deny)
    err(api(app_url, "POST", base + "/checks", body={**good, "state": "failure"}, token=read["token"]), 403, deny)
    err(api(app_url, "POST", base + "/push", body={**new, "branch": f"sd{c.tag}"}, token=other["token"]), 404, {"error": "Not found"})
    err(api(app_url, "POST", base + "/changes/1/reviews", body={"type": "comment", "summary": "x"}, token=write["token"]), 401, {"error": "Authentication required"})
    err(api(app_url, "GET", base + "/branches/main", token="rgs_" + "0" * 40), 401, {"error": "Authentication required"})
    assert branch(w, "dev", "main") == main and rules_of(w, "dev", 1).get("checks") is None
    ok(api(app_url, "DELETE", f"{base}/tokens/{write['id']}", w.users["owner"]), 204)
    err(api(app_url, "POST", base + "/push", body={**new, "branch": f"rv{c.tag}"}, token=write["token"]), 401, {"error": "Authentication required"})


def test_wf_check_lifecycle_timeout(app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c, ("lint", "unit"))
    head = change_json(w, "dev", 1)["head_revision"]
    report(w, "dev", head, "unit", "success")
    report(w, "dev", head, "lint", "in_progress")
    timeout_at = iso(revision(w, "dev", head)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS)
    advance_to(app_url, timeout_at - timedelta(seconds=1))
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "in_progress"))
    clock(app_url, 3)
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "timed_out"))
    err(w.api("dev", "POST", "/checks", {"revision": head, "name": "lint", "state": "success", "summary": "late"}), 409, {"error": "Check lint timed out"})
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "timed_out"))
    assert change_json(w, "dev", 1)["head_revision"] == head


def test_wf_check_lifecycle_rows_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c, ("lint", "unit"))
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev") as pg:
        pg.clock.set_fixed_time(FAR_FUTURE)
        open_change(pg, w)
        items = pg.get_by_role("list", name="Checks").get_by_role("listitem")
        soon(items, ACT_MS).to_have_count(2)
        names = [li.get_attribute("data-check-name") for li in items.all()]
        assert names == ["lint", "unit"]
        for n in ("lint", "unit"):
            soon(check_item(pg, n)).to_have_attribute("data-state", "queued")
            soon(check_item(pg, n)).to_contain_text(re.compile(r"Times out at \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+"))
        soon(rule_items(pg).filter(has_text=rule_checks(("lint", "queued"), ("unit", "queued")))).to_have_count(1)
        report(w, "dev", head, "lint", "in_progress")
        report(w, "dev", head, "other", "success")
        report(w, "dev", head, "unit", "failure", "boom")
        soon(check_item(pg, "lint"), LIVE_MS).to_have_attribute("data-state", "in_progress")
        soon(check_item(pg, "lint")).to_contain_text(WORD["in_progress"])
        soon(check_item(pg, "unit")).to_contain_text(WORD["failure"])
        soon(check_item(pg, "unit")).not_to_contain_text("Times out at")
        soon(check_item(pg, "other")).not_to_contain_text("Times out at")
        soon(rule_items(pg).filter(has_text=rule_checks(("lint", "in_progress"), ("unit", "failure"))), LIVE_MS).to_have_count(1)
        shown = re.search(r"Times out at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", check_item(pg, "lint").inner_text()).group(1)
        want = (iso(revision(w, "dev", head)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS)).astimezone(WORKSPACE_TZ).replace(tzinfo=None)
        assert abs(datetime.strptime(shown, "%Y-%m-%d %H:%M:%S") - want) <= timedelta(seconds=1)
        clock(app_url, CHECK_TIMEOUT_SECONDS + 2)
        eventually(lambda: rules_of(w, "dev", 1).get("checks") == rule_checks(("lint", "timed_out"), ("unit", "failure")), "lint timed out on the server clock")
        pg.reload()
        soon(check_item(pg, "lint"), ACT_MS).to_have_attribute("data-state", "timed_out")
        soon(check_item(pg, "lint")).to_contain_text(WORD["timed_out"])
        soon(check_item(pg, "unit")).to_have_attribute("data-state", "failure")
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "timed_out"), ("unit", "failure"))


def test_wf_check_lifecycle_clock(app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c)
    for headers in ({}, {"X-Grading-Key": f"wrong-{c.tag}"}):
        r = httpx.post(app_url + "/api/grading/clock", json={"advance_seconds": 0}, headers=headers, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404
    first = clock(app_url, 0)
    second = clock(app_url, 5)
    assert second["offset_seconds"] - first["offset_seconds"] == 5
    assert iso(second["now"]) - iso(first["now"]) >= timedelta(seconds=5)
    head = change_json(w, "dev", 1)["head_revision"]
    advance_to(app_url, iso(revision(w, "dev", head)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS + 3))
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "timed_out"))


def test_wf_stack_of_three_panel(browser, app_url):
    c = Cast("owner", "dev", "rev")
    solo = [S_push("dev", "p4", "solo", "Solo", {"z.txt": "z\n"}, frm="main"), S_change("dev", "c4", "Solo", "solo")]
    w = stack_world(app_url, c, solo)
    titles = {n: change_json(w, "dev", n)["title"] for n in (1, 2, 3)}
    for n in (1, 3):
        stack = change_json(w, "dev", n)["stack"]
        assert [(s["number"], s["position"], s["title"]) for s in stack] == [(1, 1, titles[1]), (2, 2, titles[2]), (3, 3, titles[3])]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 3)
        items = pg.get_by_role("list", name="Stack").get_by_role("listitem")
        soon(items).to_have_count(3)
        assert [(li.get_attribute("data-change-number"), li.get_attribute("data-stack-position")) for li in items.all()] == [("1", "1"), ("2", "2"), ("3", "3")]


def test_wf_stack_of_three_restack(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 3)
        push(w, "dev", "feat1", {"b.txt": "B9\n"})
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "kept")
        soon(updates(pg), LIVE_MS).to_contain_text(re.compile(re.escape(ann_restack(2, 1, True)) + ".*" + re.escape(ann_restack(3, 2, True)), re.S))
        push(w, "dev", "feat1", {"a.txt": "3\n"})
        soon(stack_row(pg, 2), ACT_MS).to_have_attribute("data-restack", "conflicting")
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "not_restacked")
        soon(stack_row(pg, 2)).to_contain_text(word_conflicts(1))
        soon(stack_row(pg, 3)).to_contain_text("Not restacked")
    assert change_json(w, "dev", 3)["restack"]["result"] == "not_restacked"


def test_wf_stack_of_three_rail_walk(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, [S_review("rev", "r2", "c2", "approve"), S_review("rev", "r3", "c3", "approve")])
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 3)
        watch(pg, "data-change-number")
        push(w, "dev", "feat1", {"c.txt": "C3\n"})
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "dismissed")
        walked = walked_rows(pg, 3)
        soon(stack_row(pg, 2)).to_have_attribute("data-restack", "kept")
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        soon(stack_row(pg, 3)).to_contain_text(word_dismissed(1))
        assert attr(stack_row(pg, 1), "data-restack") == ""
        assert walked == ["2", "3"] and pg.evaluate("() => window.__max") <= 1
        pg.reload()
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "dismissed")
        soon(stack_row(pg, 3)).to_have_attribute("data-anim", "none")
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")


def test_wf_stack_of_three_rail_keys(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    with as_user(browser, w, "rev", reduced="reduce") as pg:
        open_change(pg, w, 3)
        watch(pg, "data-change-number")
        push(w, "dev", "feat1", {"b.txt": "B9\n"})
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "kept")
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        assert "walking" not in anim_seen(pg)
        link = lambda n: pg.get_by_role("list", name="Stack").get_by_role("link", name=re.compile(rf"^#{n} "))
        ready(link(1)).focus()
        pg.keyboard.press("ArrowDown")
        soon(link(2)).to_be_focused()
        pg.keyboard.press("ArrowDown")
        soon(link(3)).to_be_focused()
        pg.keyboard.press("ArrowUp")
        soon(link(2)).to_be_focused()
        pg.keyboard.press("Enter")
        soon(pg).to_have_url(re.compile(r"/changes/2$"))


def test_wf_stack_merge_retarget_atomic(browser, app_url):
    c = Cast("owner", "dev", "rev")
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", "b.txt": "1\n"}), S_push("dev", "f1", "feat1", "E1", {"a.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "Mergeable", "feat1"), S_push("dev", "f2", "feat2", "E2", {"b.txt": "2\n"}, frm="main"),
             S_change("dev", "c2", "Draft one", "feat2", draft=True)]
    w = make_world(app_url, c, steps, settings={"required_approvals": 0})
    title = change_json(w, "dev", 1)["title"]
    before = branch(w, "dev", "main")
    err(w.api("dev", "POST", "/changes/2/merge"), 409, {"error": "This change has unmet merge rules and cannot be merged"})
    assert branch(w, "dev", "main") == before and change_json(w, "dev", 2)["state"] == "draft"
    head = change_json(w, "dev", 1)["head_revision"]
    merged = ok(w.api("rev", "POST", "/changes/1/merge"), 200).json()
    assert merged["state"] == "merged" and branch(w, "dev", "main") == merged["revision"]
    rv = revision(w, "dev", merged["revision"])
    assert rv["message"] == msg_merge(1, title) and rv["parents"] == [before, head] and rv["author"] == c.n("rev")
    assert raw_file(w, "dev", merged["revision"], "a.txt") == b"2\n" and change_json(w, "dev", 1)["state"] == "merged"
    err(w.api("rev", "POST", "/changes/1/merge"), 409, {"error": "This change is already merged"})
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, 1)
        soon(merge_box(pg)).to_contain_text(merged_into("main", merged["revision"]))


def test_wf_stack_merge_retarget_retarget(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, settings={"required_approvals": 0})
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 2)
        merged = ok(w.api("dev", "POST", "/changes/1/merge"), 200).json()["revision"]
        notice = pg.get_by_role("region", name="Change notices").get_by_role("listitem")
        soon(notice, LIVE_MS).to_have_attribute("data-notice", "base-changed")
        soon(notice).to_contain_text(notice_base("main", 1))
    c2, c3 = change_json(w, "dev", 2), change_json(w, "dev", 3)
    assert c2["base"] == "main" and c2["base_revision"] == merged
    assert revision(w, "dev", c2["head_revision"])["message"] == msg_restack(1)
    assert c3["base"] == c2["head"] and revision(w, "dev", c3["head_revision"])["message"] == msg_restack(2)
    assert "Base changed" not in (c3["restack"]["notice"] or "")


def test_wf_stack_merge_retarget_mail(app_url, mail):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, settings={"required_approvals": 0})
    title = change_json(w, "dev", 1)["title"]
    ok(w.api("rev", "POST", "/changes/1/merge"), 200)
    msgs = wait_mails(mail, c.people["dev"]["email"], subj_merged(c, 1, title))
    assert_change_mail(mail, msgs[0], f"{c.org}/{c.repo}#1", f"/{c.org}/{c.repo}/changes/1")
    mine = [m for m in mail.messages() if c.people["dev"]["email"] in addresses(m.get("To")) and (m.get("Subject") or "").startswith(f"[{c.org}/{c.repo}]")]
    assert mine and {m["Subject"] for m in mine} == {subj_merged(c, 1, title)}


def test_wf_stack_merge_retarget_queue_step(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c, n=1, queued=False)
    title = change_json(w, "dev", 1)["title"]
    with as_user(browser, w, "dev") as author, as_user(browser, w, "owner") as cap:
        open_change(author, w)
        btn = merge_box(author).get_by_role("button", name="Add to merge queue")
        soon(btn).to_be_enabled()
        click(btn)
        soon(action(author)).to_contain_text(queue_added(1))
        soon(merge_box(author)).to_contain_text(queue_state(1))
        cap.goto(w.url("/queue"))
        entry = qentry(cap, 1)
        soon(entry, ACT_MS).to_have_attribute("data-state", "waiting")
        qrev = re.search(r"Queue revision ([0-9a-f]{12})", entry.inner_text()).group(1)
        before = branch(w, "dev", "main")
        clock(app_url, QUEUE_STEP_SECONDS)
        assert branch(w, "dev", "main") == before
        report(w, "dev", qrev, "unit", "success")
        soon(entry, LIVE_MS).to_have_attribute("data-state", "checking")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 1)["state"] == "merged", "change #1 merged by the queue step")
    rv = revision(w, "dev", branch(w, "dev", "main"))
    assert rv["message"] == msg_merge(1, title) and rv["author"] == "merge-queue" and len(rv["parents"]) == 2
    assert change_json(w, "dev", 1)["state"] == "merged"


def test_wf_queue_middle_fails_revisions(app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    main = branch(w, "owner", "main")
    for i in (1, 2, 3):
        rv = revision(w, "owner", w.keys[f"e{i}"]["revision"])
        assert rv["message"] == msg_queue(w.num(f"c{i}"), 1) and rv["parents"] == [main]
        paths = {f["path"] for f in rv["files"]}
        assert {qp(j) for j in range(1, i + 1)} <= paths and not ({qp(j) for j in range(i + 1, 4)} & paths)
    qd = queue_data(w)
    assert {e["state"] for e in qd["entries"]} == {"waiting"}
    report(w, "dev", w.keys["e2"]["revision"], "unit", "success")
    qd = queue_data(w)
    assert entry_of(qd, w.keys["e2"]["id"])["state"] == "checking" and entry_of(qd, w.keys["e1"]["id"])["state"] == "waiting"


def test_wf_queue_middle_fails_reasons(app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    r3 = w.keys["e3"]["revision"]
    report(w, "dev", r3, "unit", "success")
    report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
    qd = queue_data(w)
    e2, e3, e1 = (entry_of(qd, ids[i]) for i in (2, 3, 1))
    assert e2["state"] == "removed" and e2["reason"] == removed_failed("unit") and ids[2] not in [e["id"] for e in qd["entries"]]
    assert e3["revision"] != r3 and e3["state"] == "waiting" and e3["position"] == 2 and e1["revision"] == w.keys["e1"]["revision"]
    rv = revision(w, "owner", e3["revision"])
    assert rv["message"] == msg_queue(w.num("c3"), 2) and qp(2) not in {f["path"] for f in rv["files"]}
    assert change_json(w, "dev", 2)["state"] == "removed"
    ok(w.api("dev", "POST", "/push", {"branch": "q4", "expected_head": None, "from": "main", "message": "Clash",
                                      "files": [{"path": qp(1), "content": f"other-{c.tag}\n"}]}), 201)
    ok(w.api("dev", "POST", "/changes", {"title": "Clash", "description": "", "head": "q4", "base": "main", "draft": False}), 201)
    report(w, "dev", change_json(w, "dev", 4)["head_revision"], "unit", "success")
    r = ok(w.api("dev", "POST", "/changes/4/queue"), 201).json()
    assert r["state"] == "removed" and r["reason"] == removed_conflict(qp(1))
    before = entry_of(queue_data(w), ids[3])["revision"]
    push(w, "dev", "q1", {qp(1): f"changed-{c.tag}\n"})
    qd = queue_data(w)
    assert entry_of(qd, ids[1])["reason"] == REMOVED_UPDATED and change_json(w, "dev", 1)["state"] == "removed"
    assert entry_of(qd, ids[3])["revision"] != before


def test_wf_queue_middle_fails_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    n2, n3 = w.num("c2"), w.num("c3")
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        soon(qentry(pg, 3), ACT_MS).to_have_attribute("data-position", "3")
        watch(pg, "data-queue-entry-id")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        soon(qentry(pg, 3), LIVE_MS).to_have_attribute("data-position", "2")
        soon(qentry(pg, 2), LIVE_MS).to_have_count(0)
        soon(pg.get_by_role("table", name="Queue history")).to_contain_text(removed_failed("unit"))
        soon(updates(pg)).to_contain_text(ann_position(n3, 2))
        soon(updates(pg)).to_contain_text(ann_reason(n2, removed_failed("unit")))
        soon(qentry(pg, 3), ACT_MS).to_have_attribute("data-anim", "none")
        assert "moving" in anim_seen(pg)


def test_wf_queue_middle_fails_journey(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        soon(qentry(pg, 3), ACT_MS).to_have_attribute("data-position", "3")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        soon(qentry(pg, 3), LIVE_MS).to_have_attribute("data-position", "2")
        report(w, "dev", w.keys["e1"]["revision"], "unit", "success")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 1)["state"] == "merged", "change #1 merged at the first queue step")
        report(w, "dev", entry_of(queue_data(w), ids[3])["revision"], "unit", "success")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 3)["state"] == "merged", "change #3 merged at the next queue step")
    paths = {f["path"] for f in revision(w, "owner", branch(w, "owner", "main"))["files"]}
    assert {qp(1), qp(3)} <= paths and qp(2) not in paths


def test_wf_queue_timeout_reorder_reorder(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    revs = {i: w.keys[f"e{i}"]["revision"] for i in (1, 2, 3)}
    report(w, "dev", revs[2], "unit", "success")
    report(w, "dev", revs[3], "unit", "success")
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        soon(qentry(pg, 3), ACT_MS).to_be_visible()
        soon(qentry(pg, 1).get_by_role("button", name="Move up")).to_be_disabled()
        soon(qentry(pg, 3).get_by_role("button", name="Move down")).to_be_disabled()
        watch(pg, "data-queue-entry-id")
        ready(qentry(pg, 3)).focus()
        pg.keyboard.press("Alt+ArrowUp")
        soon(qentry(pg, 3), LIVE_MS).to_have_attribute("data-position", "2")
        soon(qentry(pg, 2)).to_have_attribute("data-position", "3")
        soon(qentry(pg, 3)).to_be_focused()
        soon(qentry(pg, 3), ACT_MS).to_have_attribute("data-anim", "none")
        assert "moving" in anim_seen(pg)
    qd = queue_data(w)
    e1, e2, e3 = (entry_of(qd, ids[i]) for i in (1, 2, 3))
    assert (e1["position"], e3["position"], e2["position"]) == (1, 2, 3) and e1["revision"] == revs[1]
    assert e3["revision"] != revs[3] and e2["revision"] != revs[2] and e3["state"] == e2["state"] == "waiting"
    assert qp(2) not in {f["path"] for f in revision(w, "owner", e3["revision"])["files"]}
    with as_user(browser, w, "owner", reduced="reduce") as pg:
        pg.goto(w.url("/queue"))
        watch(pg, "data-queue-entry-id")
        click(qentry(pg, 1).get_by_role("button", name="Move down"))
        soon(qentry(pg, 1), LIVE_MS).to_have_attribute("data-position", "2")
        assert "moving" not in anim_seen(pg)
    after = queue_data(w)
    assert all(entry_of(after, ids[i])["revision"] != entry_of(qd, ids[i])["revision"] for i in (1, 2, 3))
    err(w.api("owner", "PUT", f"/queue/{ids[1]}/position", {"position": 4}), 422, {"errors": {"position": position_range(3)}})
    err(w.api("dev", "PUT", f"/queue/{ids[1]}/position", {"position": 1}), 403, {"error": "Only maintainers and owners can do that"})
    cur = entry_of(queue_data(w), ids[1])
    ok(w.api("owner", "PUT", f"/queue/{ids[1]}/position", {"position": cur["position"]}), 200)
    assert entry_of(queue_data(w), ids[1])["revision"] == cur["revision"]


def test_wf_queue_timeout_reorder_timeout(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c, n=1)
    eid, qrev = w.keys["e1"]["id"], w.keys["e1"]["revision"]
    timeout_at = iso(revision(w, "owner", qrev)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS)
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        soon(qentry(pg, 1), ACT_MS).to_be_visible()
        advance_to(app_url, timeout_at - timedelta(seconds=QUEUE_STEP_SECONDS))
        before = queue_data(w)
        read_by = iso(clock(app_url, 0)["now"]) + timedelta(seconds=1)
        if read_by < timeout_at:
            assert eid in [e["id"] for e in before["entries"]], f"entry removed at server time {read_by}, timeout {timeout_at}"
            soon(qentry(pg, 1)).to_be_visible()
        advance_to(app_url, timeout_at + timedelta(seconds=2))
        eventually(lambda: entry_of(queue_data(w), eid)["reason"] == removed_timeout("unit"), "head entry removed with the timeout reason")
        pg.reload()
        soon(pg.get_by_role("table", name="Queue history"), ACT_MS).to_contain_text(removed_timeout("unit"))
    assert entry_of(queue_data(w), eid)["reason"] == removed_timeout("unit") and change_json(w, "dev", 1)["state"] == "removed"


def test_wf_queue_timeout_reorder_admission(app_url):
    c = Cast("owner", "dev", "rev")
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n"}), S_push("dev", "f1", "feat1", "E1", {"a.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "Plain", "feat1"), S_push("dev", "f2", "feat2", "E2", {"b.txt": "2\n"}, frm="feat1"), S_change("dev", "c2", "Stacked", "feat2", "feat1"),
             S_push("dev", "f3", "feat3", "E3", {"c.txt": "3\n"}, frm="main"), S_change("dev", "c3", "Draft", "feat3", draft=True)]
    w = make_world(app_url, c, steps, settings={"required_approvals": 0, "required_checks": ["unit"], "queue": True})
    q = lambda n: w.api("dev", "POST", f"/changes/{n}/queue")
    err(q(3), 409, {"error": "A draft change cannot join the merge queue"})
    err(q(2), 409, {"error": "Only changes based on main can join the merge queue"})
    err(q(1), 409, {"error": "This change has unmet merge rules and cannot join the merge queue"})
    report(w, "dev", change_json(w, "dev", 1)["head_revision"], "unit", "success")
    ok(q(1), 201)
    err(q(1), 409, {"error": "This change is already in the merge queue"})
    assert len(queue_data(w)["entries"]) == 1
    c2 = Cast("owner", "dev")
    w2 = make_world(app_url, c2, [S_push("dev", "base", "main", "B", {"a.txt": "1\n"}), S_push("dev", "f", "feat", "E", {"a.txt": "2\n"}, frm="main"), S_change("dev", "c1", "T", "feat")],
                    settings={"required_approvals": 0})
    err(w2.api("dev", "POST", "/changes/1/queue"), 409, {"error": "This repository does not use a merge queue"})
    ok(w2.api("dev", "POST", "/changes/1/merge"), 200)
    err(w2.api("dev", "POST", "/changes/1/queue"), 409, {"error": "This change is already merged"})


def test_wf_queue_timeout_reorder_steps(app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = [w.keys[f"e{i}"]["id"] for i in (1, 2, 3)]
    revs = [w.keys[f"e{i}"]["revision"] for i in (1, 2, 3)]
    for r in revs:
        report(w, "dev", r, "unit", "success")
    assert len(queue_data(w)["entries"]) == 3
    for done in (1, 2, 3):
        clock(app_url, QUEUE_STEP_SECONDS)
        qd = queue_data(w)
        states = [entry_of(qd, i)["state"] for i in ids]
        merged_count = states.count("merged")
        assert merged_count >= done and states[:merged_count] == ["merged"] * merged_count, states
        for i in range(merged_count, 3):
            assert entry_of(qd, ids[i])["revision"] == revs[i]
    assert {qp(1), qp(2), qp(3)} <= {f["path"] for f in revision(w, "owner", branch(w, "owner", "main"))["files"]}


def test_wf_stale_head_edit_api(app_url):
    c = Cast("owner", "dev", "rdr", "out")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"keep.txt": "k\n"})], roles={"rdr": "reader", "out": None})
    head = branch(w, "dev", "main")
    good = {"branch": "main", "expected_head": head, "message": "Add n", "files": [{"path": "n.txt", "content": "n\n"}]}
    err(w.api(None, "POST", "/push", raw=sized(PUSH_LIMIT + 1)), 401, {"error": "Authentication required"})
    err(w.api("out", "POST", "/push", {"files": 3}), 404, {"error": "Not found"})
    err(w.api("rdr", "POST", "/push", raw=sized(PUSH_LIMIT + 1)), 403, {"error": "You need write access to do that"})
    err(w.api("dev", "POST", "/push", raw=sized(PUSH_LIMIT + 1)), 413, {"error": limit_msg(PUSH_LIMIT)})
    err(api(app_url, "POST", "/api/orgs", w.users["dev"], raw=sized(JSON_LIMIT + 1)), 413, {"error": limit_msg(JSON_LIMIT)})
    assert api(app_url, "POST", "/api/orgs", w.users["dev"], raw=sized(JSON_LIMIT)).status_code != 413
    err(w.api("dev", "POST", "/push", raw=b"not json"), 422, {"errors": {"body": "Body must be JSON"}})
    old = revision(w, "dev", head)["parents"][0]
    stale = {**good, "expected_head": old, "files": [{"path": ESCAPING_PATH, "content": "x"}]}
    err(w.api("dev", "POST", "/push", stale), 409, {"error": "Stale head", "current_head": head})
    not_text = base64.b64encode(b"\xff\xfe").decode()
    bad = [({"files": [{"path": ESCAPING_PATH, "content": "x"}]}, {"files.0.path": "Invalid path"}),
           ({"files": [{"path": PLAIN_PATH, "content": "1"}, {"path": PLAIN_PATH, "content": "2"}]}, {"files.1.path": "Duplicate path"}),
           ({"files": [{"path": ABSENT_PATH, "delete": True}]}, {"files.0.path": "Path does not exist"}),
           ({"files": [{"path": NOT_TEXT_PATH, "content_base64": not_text}]}, {"files.0.content_base64": not_utf8(NOT_TEXT_PATH)}),
           ({"message": ""}, {"message": "Message is required"})]
    for patch, errors in bad:
        err(w.api("dev", "POST", "/push", {**good, **patch}), 422, {"errors": errors})
    err(w.api("dev", "POST", "/push", {**good, "branch": JUNK_BRANCH, "expected_head": None, "from": "main"}), 422, {"errors": {"branch": "Invalid branch name"}})
    missing = dict(good)
    del missing["files"]
    err(w.api("dev", "POST", "/push", missing), 422, {"errors": {"files": need_field("files")}})
    assert branch(w, "dev", "main") == head
    done = ok(w.api("dev", "POST", "/push", good), 201).json()
    assert re.fullmatch(r"[0-9a-f]{12}", done["revision"]) and done["branch"] == "main" and done["parent"] == head
    rv = revision(w, "dev", done["revision"])
    assert rv["parents"] == [head] and rv["message"] == good["message"] and rv["author"] == c.n("dev") and {"path": "n.txt", "size": 2} in rv["files"]
    new = {"branch": "side", "expected_head": None, "from": "main", "message": "Branch", "files": [{"path": "s.txt", "content": "s"}]}
    ok(w.api("dev", "POST", "/push", new), 201)
    err(w.api("dev", "POST", "/push", new), 409, {"error": "Stale head", "current_head": branch(w, "dev", "side")})


def test_wf_stale_head_edit_concurrent(app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"n.txt": "0\n"})])
    head = branch(w, "dev", "main")
    go = lambda i: w.api("dev", "POST", "/push", {"branch": "main", "expected_head": head, "message": f"save {i}", "files": [{"path": "n.txt", "content": f"{i}\n"}]})
    with concurrent.futures.ThreadPoolExecutor(6) as ex:
        rs = list(ex.map(go, range(6)))
    wins = [r for r in rs if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in rs]
    winner = wins[0].json()["revision"]
    for r in rs:
        if r is not wins[0]:
            err(r, 409, {"error": "Stale head", "current_head": winner})
    assert branch(w, "dev", "main") == winner and revision(w, "dev", winner)["parents"] == [head]


def test_wf_stale_head_edit_retry(app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"n.txt": "0\n"})])
    head = branch(w, "dev", "main")
    body = {"branch": "main", "expected_head": head, "message": "Once", "files": [{"path": "n.txt", "content": "1\n"}]}
    first = ok(w.api("dev", "POST", "/push", body), 201).json()["revision"]
    for _ in range(2):
        err(w.api("dev", "POST", "/push", body), 409, {"error": "Stale head", "current_head": first})
    assert branch(w, "dev", "main") == first and revision(w, "dev", first)["parents"] == [head]


def test_wf_stale_head_edit_editor(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"notes.txt": "v0\n"})])
    url = w.url("/edit/main/notes.txt")
    from_a, typed = f"alpha-{c.tag}\n", f"typed-b-{c.tag}\n"
    with as_user(browser, w, "dev") as a, as_user(browser, w, "rev") as b:
        for pg in (a, b):
            pg.goto(url)
            soon(pg.get_by_role("textbox", name="File content"), ACT_MS).to_have_value(re.compile("v0"))
        fill(a.get_by_role("textbox", name="File content"), from_a)
        fill(a.get_by_role("textbox", name="Revision message"), f"a-edit-{c.tag}")
        click(a.get_by_role("button", name="Save file"))
        soon(action(a), ACT_MS).to_contain_text("Saved as revision ")
        saved = re.search(r"revision ([0-9a-f]{12})\.", action(a).inner_text()).group(1)
        fill(b.get_by_role("textbox", name="File content"), typed)
        fill(b.get_by_role("textbox", name="Revision message"), f"b-edit-{c.tag}")
        btn = b.get_by_role("button", name="Save file")
        ready(btn).focus()
        b.keyboard.press("Enter")
        strip = b.get_by_role("alert", name="Announcement")
        soon(strip, ACT_MS).to_contain_text(stale_notice("main"))
        soon(b.get_by_role("textbox", name="File content")).to_have_value(typed)
        assert branch(w, "dev", "main") == saved
        load = strip.get_by_role("button", name="Load latest")
        ready(load).focus()
        b.keyboard.press("Enter")
        soon(b.get_by_role("region", name="Latest version"), ACT_MS).to_contain_text(from_a.strip())
        soon(b.get_by_role("textbox", name="File content")).to_have_value(typed)
        click(btn)
        soon(action(b), ACT_MS).to_contain_text("Saved as revision ")
    assert raw_file(w, "dev", branch(w, "dev", "main"), "notes.txt") == typed.encode()


def test_wf_phone_review_layout(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c, extra=[S_push("dev", "long", "feat", "Long line", {"a.txt": "l1\n" + "long " * 80 + "\nl3\n"})])
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        soon(pg.get_by_role("radiogroup", name="Diff view")).to_have_count(0)
        soon(pg.get_by_role("navigation", name="File tree")).to_have_count(0)
        soon(row(pg, "a.txt", unchanged(1, "l1"))).to_have_count(1)
        layout(pg)
        files = pg.get_by_role("button", name="Files")
        click(files)
        dlg = pg.get_by_role("dialog", name="Files")
        soon(dlg.get_by_role("link", name="a.txt")).to_be_visible()
        soon(dlg.get_by_role("link", name="b.txt")).to_be_visible()
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(files).to_be_focused()


def test_wf_phone_review_touch(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        tap(row(pg, "a.txt", added(2, "L2")))
        tap(pg.get_by_role("button", name=comment_button(2)))
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        fill(dlg.get_by_role("textbox", name="Comment", exact=True), f"touch-{c.tag}")
        tap(dlg.get_by_role("button", name="Add comment"))
        soon(action(pg), ACT_MS).to_contain_text("Comment added.")
        soon(thread(pg, "a.txt", 2)).to_be_visible()
        tap(pg.get_by_role("button", name="Review changes"))
        rd = pg.get_by_role("dialog", name="Submit review")
        turn_on(rd.get_by_role("radio", name="Approve"), touch=True)
        tap(rd.get_by_role("button", name="Submit review"))
        soon(action(pg), ACT_MS).to_contain_text("Review submitted.")
        soon(pg.get_by_role("list", name="Reviews").get_by_role("listitem").first, ACT_MS).to_have_attribute("data-state", "approved")
    assert change_json(w, "dev", 1)["counts"]["approvals_remaining"] == 0


def test_wf_phone_review_live_merge_box(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev", size=PHONE) as pg:
        open_change(pg, w)
        soon(rule_items(pg).filter(has_text="Required checks not passed")).to_have_count(1)
        report(w, "dev", head, "lint", "success")
        soon(rule_items(pg).filter(has_text="Required checks not passed"), LIVE_MS).to_have_count(0)
        assert small_controls(pg) == []


def test_wf_phone_review_widen(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    sig = lambda pg: {(r.get_attribute("data-path"), r.get_attribute("data-kind"), r.get_attribute("data-old-line"), r.get_attribute("data-new-line"), r.get_attribute("data-side"))
                      for r in pg.get_by_role("row").all() if r.get_attribute("data-kind") in ("added", "removed")}
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        narrow = sig(pg)
        assert narrow
        pg.set_viewport_size({"width": DIFF_BREAKPOINT_PX - 1, "height": TABLET["height"]})
        soon(pg.get_by_role("radiogroup", name="Diff view")).to_have_count(0)
        pg.set_viewport_size(TABLET)
        soon(pg.get_by_role("radiogroup", name="Diff view")).to_be_visible()
        soon(pg.get_by_role("navigation", name="File tree")).to_be_visible()
        turn_on(pg.get_by_role("radio", name="Split"))
        soon(row(pg, "a.txt", unchanged(1, "l1"))).to_have_count(2)
        assert sig(pg) == narrow


def test_wf_screen_reader_review_names(browser, app_url):
    c = Cast("owner", "dev", "rev")
    steps = [S_push("dev", "base", "main", "Base", {"c.txt": "keep\n\nold\n", "d.txt": "x\n\ny\n"}),
             S_push("dev", "feat", "feat", "Edit", {"c.txt": "keep\n\nnew\n\n", "d.txt": "x\ny\n"}, frm="main"), S_change("dev", "c1", "Names", "feat")]
    w = make_world(app_url, c, steps)
    empty = "(empty line)"
    expect_rows = {"c.txt": ["@@ -1,3 +1,4 @@", unchanged(1, "keep"), unchanged(2, empty), removed(3, "old"), added(3, "new"), added(4, empty)],
                   "d.txt": [unchanged(1, "x"), removed(2, empty), unchanged(2, "y")]}
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for path, names in expect_rows.items():
            for name in names:
                soon(row(pg, path, name)).to_have_count(1)


def test_wf_screen_reader_review_updates(browser, app_url):
    c = Cast("owner", "dev", "rev", "mnt")
    w = diff_world(app_url, c, settings={"required_approvals": 1}, extra=[S_check("dev", "k", "feat", "lint", "queued")])
    head = change_json(w, "dev", 1)["head_revision"]
    seq = []
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(pg.get_by_role("status", name="Review updates")).to_have_count(1)

        def step(sentence):
            soon(updates(pg), LIVE_MS).to_contain_text(sentence)
            seq.append(sentence)
        bad = ok(review_api(w, "mnt", 1, "request_changes", "No"), 201).json()["id"]
        step(ann_review(1, c.name("mnt"), "requested changes"))
        ok(review_api(w, "rev", 1, "approve"), 201)
        step(ann_review(1, c.name("rev"), "approved"))
        report(w, "dev", head, "lint", "success")
        step(ann_check(1, "lint", "success"))
        ok(w.api("rev", "POST", "/changes/1/threads", {"path": "a.txt", "side": "new", "line": 3, "end_line": 3, "body": f"hello-{c.tag}"}), 201)
        step(ann_comment(1, c.name("rev")))
        ok(w.api("owner", "POST", f"/changes/1/reviews/{bad}/dismiss", {"reason": "Handled"}), 200)
        step(ann_dismissed(1, c.name("mnt")))
        ok(w.api("dev", "POST", "/changes/1/merge"), 200)
        step(ann_merged(1))
        in_order(updates(pg).text_content(), seq)
    assert change_json(w, "dev", 1)["state"] == "merged"


def test_wf_screen_reader_review_dialog_focus(browser, app_url):
    c = Cast("owner", "dev", "rev", "mnt")
    w = diff_world(app_url, c, extra=[S_review("mnt", "rc", "c1", "request_changes", "Fix it")])
    with as_user(browser, w, "owner") as pg:
        open_change(pg, w)
        for opener_name, dialog_name in (("Review changes", "Submit review"), ("Dismiss review", "Dismiss review")):
            opener = pg.get_by_role("button", name=opener_name, exact=True).first
            click(opener)
            dlg = pg.get_by_role("dialog", name=dialog_name)
            soon(dlg).to_be_visible()
            trap(pg, dlg)
            pg.keyboard.press("Escape")
            soon(dlg).to_have_count(0)
            soon(opener).to_be_focused()
        click(row(pg, "a.txt", added(2, "L2")))
        opener = pg.get_by_role("button", name=comment_button(2))
        click(opener)
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        trap(pg, dlg)
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(opener).to_be_focused()


LINES12 = "".join(f"l{i}\n" for i in range(1, 13))
DIFF_BASE = {"ex-a.txt": "a\nb\nc\n", "ex-c.txt": LINES12, "ex-d.txt": "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n", "ex-e.txt": "a\n", "ex-f.txt": "x\n", "ex-g.txt": "g\n"}
DIFF_HEAD = {"ex-a.txt": "a\nB\nc\n", "ex-b.txt": "x\ny", "ex-c.txt": LINES12.replace("l2\n", "L2\n").replace("l11\n", "L11\n"),
             "ex-d.txt": "X1\nl2\nl3\nl4\nl5\nl6\nl7\nX8\n", "ex-e.txt": "a\na\n", "ex-f.txt": "x", "ex-g.txt": None}


def R(kind, old, new, text):
    return (kind, old, new, text)


EXPECTED_DIFF = {
    "ex-a.txt": [("@@ -1,3 +1,3 @@", [R("context", 1, 1, "a"), R("removed", 2, None, "b"), R("added", None, 2, "B"), R("context", 3, 3, "c")])],
    "ex-b.txt": [("@@ -0,0 +1,2 @@", [R("added", None, 1, "x"), R("added", None, 2, "y")])],
    "ex-c.txt": [("@@ -1,5 +1,5 @@", [R("context", 1, 1, "l1"), R("removed", 2, None, "l2"), R("added", None, 2, "L2"), R("context", 3, 3, "l3"), R("context", 4, 4, "l4"), R("context", 5, 5, "l5")]),
                 ("@@ -8,5 +8,5 @@", [R("context", 8, 8, "l8"), R("context", 9, 9, "l9"), R("context", 10, 10, "l10"), R("removed", 11, None, "l11"), R("added", None, 11, "L11"), R("context", 12, 12, "l12")])],
    "ex-d.txt": [("@@ -1,8 +1,8 @@", [R("removed", 1, None, "l1"), R("added", None, 1, "X1")] + [R("context", i, i, f"l{i}") for i in range(2, 8)] + [R("removed", 8, None, "l8"), R("added", None, 8, "X8")])],
    "ex-e.txt": [("@@ -1,1 +1,2 @@", [R("context", 1, 1, "a"), R("added", None, 2, "a")])],
    "ex-f.txt": [],
    "ex-g.txt": [("@@ -1,1 +0,0 @@", [R("removed", 1, None, "g")])],
}


def test_wf_screen_reader_review_line_diff(browser, app_url):
    c = Cast("owner", "dev", "rev")
    steps = [S_push("dev", "base", "main", "Base", DIFF_BASE), S_push("dev", "feat", "feat", "Edit", DIFF_HEAD, frm="main"), S_change("dev", "c1", "Diffs", "feat")]
    w = make_world(app_url, c, steps)
    files = {f["path"]: f for f in ok(w.api("rev", "GET", "/changes/1/diff"), 200).json()["files"]}
    assert list(files) == sorted(files, key=bkey)
    for path, hunks in EXPECTED_DIFF.items():
        got = [(h["header"], [(r["kind"], r["old_line"], r["new_line"], r["text"]) for r in h["rows"] if r["kind"] != "hunk"]) for h in files[path]["hunks"]]
        assert got == hunks, path
    assert files["ex-b.txt"]["status"] == "added" and files["ex-g.txt"]["status"] == "deleted" and files["ex-a.txt"]["status"] == "modified"
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for header in ("@@ -1,3 +1,3 @@", "@@ -1,5 +1,5 @@", "@@ -8,5 +8,5 @@", "@@ -0,0 +1,2 @@"):
            soon(pg.get_by_role("row", name=header, exact=True).first).to_be_visible()


def test_wf_roles_boundaries_reader(browser, app_url):
    c = Cast("owner", "dev", "rdr")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Add a", {"a.txt": "l1\n"}), S_push("dev", "feat", "feat", "Edit", {"a.txt": "l1\nL2\n"}, frm="main"), S_change("dev", "c1", "T", "feat")],
                   roles={"rdr": "reader"})
    reason = "Readers cannot approve or request changes"
    own = "You cannot approve your own change"
    for kind in ("approve", "request_changes"):
        err(review_api(w, "rdr", 1, kind, "why"), 403, {"error": reason})
    ok(review_api(w, "rdr", 1, "comment", "just a note"), 201)
    ok(w.api("rdr", "POST", "/changes/1/threads", {"path": "a.txt", "side": "new", "line": 2, "end_line": 2, "body": f"reader-{c.tag}"}), 201)
    err(review_api(w, "dev", 1, "approve"), 403, {"error": own})
    err(w.api("rdr", "POST", "/push", {"branch": "feat", "expected_head": w.keys["base"]["revision"], "message": "m", "files": []}), 403, {"error": "You need write access to do that"})
    with as_user(browser, w, "rdr") as pg:
        open_change(pg, w)
        click(pg.get_by_role("button", name="Review changes"))
        dlg = pg.get_by_role("dialog", name="Submit review")
        for name in ("Approve", "Request changes"):
            soon(dlg.get_by_role("radio", name=name)).to_be_disabled()
        soon(dlg).to_contain_text(reason)
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        click(pg.get_by_role("button", name="Review changes"))
        soon(pg.get_by_role("dialog", name="Submit review").get_by_role("radio", name="Approve")).to_be_disabled()
        soon(pg.get_by_role("dialog", name="Submit review")).to_contain_text(own)


def test_wf_roles_boundaries_private(browser, app_url):
    c = Cast("owner", "dev", "out")
    side = {"roles": {"dev": "owner", "out": "writer"}, "steps": [S_push("dev", "sb", "main", "S", {"s.txt": "s\n"}), S_push("dev", "sf", "sfeat", "S2", {"s.txt": "t\n"}, frm="main"), S_change("dev", "sc", "Side", "sfeat")]}
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"a.txt": "1\n"}), S_push("dev", "feat", "feat", "E", {"a.txt": "2\n"}, frm="main"), S_change("dev", "c1", "Hidden", "feat"),
                                S_thread("dev", "t", "c1", "a.txt", 1, f"secret-{c.tag}")], roles={"out": None}, side=side)
    rev, tid = w.keys["base"]["revision"], w.keys["t"]["id"]
    cases = [("GET", ""), ("GET", "/changes"), ("GET", "/changes/1"), ("GET", "/changes/1/diff"), ("GET", "/branches/main"), ("GET", f"/revisions/{rev}"), ("GET", f"/revisions/{rev}/files/a.txt"),
             ("POST", f"/revisions/{rev}/archive"), ("POST", "/changes/1/threads"), ("POST", f"/changes/1/threads/{tid}/replies"), ("PUT", f"/changes/1/threads/{tid}/state"),
             ("POST", "/changes/1/reviews"), ("PUT", "/changes/1/viewed"), ("POST", "/changes/1/suggestions/apply"), ("GET", "/queue"), ("POST", "/push"), ("POST", "/checks")]
    for method, tail in cases:
        err(w.api("out", method, tail, {} if method != "GET" else None), 404, {"error": "Not found"})
    sp = f"/api/repos/{c.org}/{c.side}"
    for method, tail in (("POST", f"/changes/1/threads/{tid}/replies"), ("GET", f"/revisions/{rev}")):
        err(api(app_url, method, sp + tail, w.users["out"], {"body": "x"} if method == "POST" else None), 404, {"error": "Not found"})
    assert w.api("dev", "GET", "/changes/1").status_code == 200
    with as_user(browser, w, "out") as pg:
        for tail in ("/changes/1", f"/revisions/{rev}", "/blob/main/a.txt"):
            assert pg.goto(w.url(tail)).status == 404
            soon(pg.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()
            soon(pg.get_by_text("It may not exist, or you may not have access to it.")).to_be_visible()
            soon(pg.get_by_role("link", name="Back to the inbox")).to_be_visible()
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(w.url("/changes/1"))
        soon(pg).to_have_url(re.compile(r"/login(\?[^#]*)?$"))


def test_wf_roles_boundaries_dismiss(browser, app_url):
    c = Cast("owner", "dev", "mnt", "rev")
    w = diff_world(app_url, c, settings={"required_approvals": 0, "required_checks": []}, extra=[S_review("rev", "rc", "c1", "request_changes", "Fix it")],
                   roles={"mnt": "maintainer"})
    rid = w.keys["rc"]["id"]
    reason = f"handled-{c.tag}"
    err(w.api("dev", "POST", f"/changes/1/reviews/{rid}/dismiss", {"reason": "x"}), 403, {"error": "Only maintainers and owners can do that"})
    with as_user(browser, w, "dev") as author, as_user(browser, w, "mnt") as mnt:
        for pg in (author, mnt):
            open_change(pg, w)
        soon(rule_items(author).filter(has_text=rule_changes(c.name("rev")))).to_have_count(1)
        click(mnt.get_by_role("button", name="Dismiss review"))
        dlg = mnt.get_by_role("dialog", name="Dismiss review")
        click(dlg.get_by_role("button", name="Confirm dismissal"))
        soon(dlg.get_by_role("alert")).to_contain_text("A reason is required")
        fill(dlg.get_by_role("textbox", name="Reason"), reason)
        click(dlg.get_by_role("button", name="Confirm dismissal"))
        soon(action(mnt), ACT_MS).to_contain_text("Review dismissed.")
        item = mnt.get_by_role("list", name="Reviews").get_by_role("listitem").first
        soon(item).to_have_attribute("data-state", "dismissed")
        soon(item).to_contain_text(dismissed_by(c.name("mnt"), reason))
        soon(rule_items(author).filter(has_text="Changes requested by"), LIVE_MS).to_have_count(0)
        soon(updates(author), LIVE_MS).to_contain_text(ann_dismissed(1, c.name("rev")))
    err(w.api("mnt", "POST", f"/changes/1/reviews/{rid}/dismiss", {"reason": "again"}), 409, {"error": "This review is already dismissed"})
    assert change_json(w, "dev", 1)["changes_requested"] is False


def test_wf_roles_boundaries_admin(browser, app_url):
    c = Cast("owner", "mnt", "dev", "rdr", "newb")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"a.txt": "1\n"})], roles={"mnt": "maintainer", "rdr": "reader", "newb": None}, team=("dev",))
    good = {"required_approvals": 2, "required_checks": ["lint", "unit"], "queue": True}
    assert ok(w.api("mnt", "PUT", "/settings", good), 200).json() == good
    assert ok(w.api("rdr", "GET", ""), 200).json()["settings"] == good
    err(w.api("mnt", "PUT", "/settings", {"required_approvals": 11}), 422, {"errors": {"required_approvals": "Must be a whole number from 0 to 10"}})
    err(w.api("mnt", "PUT", "/settings", {"required_checks": ["a", "a"]}), 422, {"errors": {"required_checks": "Must be at most 20 unique names of 1 to 64 characters"}})
    err(w.api("dev", "PUT", "/settings", good), 403, {"error": "Only maintainers and owners can do that"})
    t = ok(w.api("mnt", "POST", "/tokens", {"name": "runner", "access": "write"}), 201).json()
    assert re.fullmatch(r"rgs_[0-9a-f]{40}", t["token"]) and t["name"] == "runner" and t["access"] == "write"
    ok(w.api("mnt", "DELETE", f"/tokens/{t['id']}"), 204)
    err(w.api("dev", "POST", "/tokens", {"name": "x", "access": "read"}), 403, {"error": "Only maintainers and owners can do that"})
    ok(w.api("mnt", "PUT", "/roles", {"subject": f"user:{c.n('newb')}", "role": "reader"}), 204)
    err(w.api("mnt", "PUT", "/roles", {"subject": f"user:{c.n('newb')}", "role": "owner"}), 403, {"error": "Only owners can grant owner"})
    ok(w.api("owner", "PUT", "/roles", {"subject": f"user:{c.n('newb')}", "role": "owner"}), 204)
    ok(w.api("mnt", "PUT", "/roles", {"subject": f"team:{c.team}", "role": "writer"}), 204)
    assert w.api("mnt", "PUT", "/roles", {"subject": f"user:nobody{c.tag}", "role": "reader"}).status_code == 404
    ok(w.api("mnt", "DELETE", f"/roles/user:{c.n('newb')}"), 204)
    err(w.api("dev", "DELETE", f"/roles/user:{c.n('rdr')}"), 403, {"error": "Only maintainers and owners can do that"})
    org = lambda who, method, tail, body=None: api(app_url, method, f"/api/orgs/{c.org}{tail}", w.users[who], body)
    team_name = f"x{c.tag}"
    err(org("mnt", "POST", "/teams", {"name": team_name}), 403, {"error": "Only organisation owners can do that"})
    assert ok(org("owner", "POST", "/teams", {"name": team_name}), 201).json() == {"name": team_name}
    ok(org("owner", "PUT", f"/teams/{team_name}/members/{c.n('dev')}"), 204)
    new_repo = f"n{c.tag}"
    new = ok(org("owner", "POST", "/repos", {"name": new_repo, "visibility": "private"}), 201).json()
    assert new["default_branch"] == "main" and new["org"] == c.org
    got = ok(api(app_url, "GET", f"/api/repos/{c.org}/{new_repo}", w.users["owner"]), 200).json()
    assert got["settings"] == DEFAULT_SETTINGS and got["your_role"] == "owner"
    assert org("owner", "POST", "/repos", {"name": new_repo, "visibility": "private"}).status_code == 422
    with as_user(browser, w, "mnt") as pg:
        pg.goto(w.url("/settings"))
        fill(pg.get_by_role("spinbutton", name="Required approvals"), "3")
        fill(pg.get_by_role("textbox", name="Required checks"), "lint,unit")
        click(pg.get_by_role("button", name="Save rules"))
        soon(action(pg), ACT_MS).to_contain_text("Rules saved.")
        fill(pg.get_by_role("textbox", name="Token name"), f"ui-{c.tag}")
        select(pg.get_by_role("combobox", name="Token access"), "Write")
        click(pg.get_by_role("button", name="Create token"))
        soon(pg.get_by_role("region", name="New token"), ACT_MS).to_contain_text("Copy this token now. It is not shown again.")
    assert ok(w.api("mnt", "GET", ""), 200).json()["settings"]["required_approvals"] == 3


def test_wf_mail_and_archive_change_mail(app_url, mail):
    c = Cast("owner", "dev", "rev", "ment", "out")
    w = diff_world(app_url, c, roles={"out": None})
    title = change_json(w, "dev", 1)["title"]
    link = f"/{c.org}/{c.repo}/changes/1"
    err(w.api("dev", "POST", "/changes/1/review-requests", {"username": c.n("out")}), 404, {"error": "Not found"})
    assert ok(w.api("dev", "POST", "/changes/1/review-requests", {"username": c.n("rev")}), 201).json() == {"username": c.n("rev")}
    first = wait_mails(mail, c.people["rev"]["email"], subj_review(c, 1, title))
    assert_change_mail(mail, first[0], f"{c.org}/{c.repo}#1", link)
    assert ok(w.api("dev", "POST", "/changes/1/review-requests", {"username": c.n("rev")}), 200)
    body = f"@{c.n('ment')} @{c.n('ment')} @{c.n('out')} @nobody{c.tag} look"
    ok(w.api("rev", "POST", "/changes/1/threads", {"path": "a.txt", "side": "new", "line": 3, "end_line": 3, "body": body}), 201)
    mention = wait_mails(mail, c.people["ment"]["email"], subj_mention(c, 1, c.name("rev")))
    assert link in mail_text(mention[0])
    got = mail.messages()
    assert not [m for m in got if c.people["out"]["email"] in addresses(m.get("To"))]
    ok(review_api(w, "rev", 1, "comment", "seen"), 201)
    ok(w.api("dev", "POST", "/changes/1/review-requests", {"username": c.n("rev")}), 201)
    wait_mails(mail, c.people["rev"]["email"], subj_review(c, 1, title), 2)


def test_wf_mail_and_archive_signup(browser, app_url, mail):
    tag = uuid.uuid4().hex[:8]
    user, email = f"visitor{tag}", f"visitor{tag}@tests.example"
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(app_url)
        click(pg.get_by_role("link", name="Open a workspace"))
        soon(pg).to_have_url(re.compile(r"/signup$"))
        fill(pg.get_by_role("textbox", name="Email", exact=True), email)
        fill(pg.get_by_role("textbox", name="Username", exact=True), user)
        fill(pg.get_by_role("textbox", name="Full name", exact=True), f"Visitor {tag}")
        fill(pg.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(pg.get_by_role("button", name="Create account"))
        soon(action(pg), ACT_MS).to_contain_text("Your account is created. The confirmation email is on its way.")
    msg = wait_mails(mail, email, "Confirm your Ridgestack account")[0]
    token = re.search(r"/confirm/([^\s\"'<>)]+)", mail_text(msg)).group(1)
    login = lambda pw: api(app_url, "POST", "/api/login", body={"email": email, "password": pw})
    err(login(PASSWORD), 403, {"error": "Confirm your email first"})
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(f"{app_url}/confirm/{token}")
        click(pg.get_by_role("button", name="Confirm email"))
        soon(action(pg), ACT_MS).to_contain_text("Your email is confirmed.")
    r = ok(login(PASSWORD), 200)
    assert r.json() == {"username": user, "name": f"Visitor {tag}"} and COOKIE in r.headers.get("set-cookie", "")
    err(login(f"wrong-{tag}"), 401, {"error": "Email or password is wrong"})
    assert api(app_url, "POST", "/api/confirm", body={"token": token}).status_code == 404
    err(api(app_url, "POST", "/api/signup", body={"email": f"x{tag}@tests.example", "username": "merge-queue", "name": "N", "password": PASSWORD}), 422, {"errors": {"username": "Username is taken"}})
    err(api(app_url, "POST", "/api/signup", body={"email": f"y{tag}@tests.example", "username": f"y{tag}", "name": "N", "password": "short"}), 422, {"errors": {"password": "Password must be at least 8 characters"}})


def test_wf_mail_and_archive_export(browser, app_url):
    c = Cast("owner", "dev", "rev")
    message = f"Archive-{c.tag}"
    w = make_world(app_url, c, [S_push("dev", "base", "main", message, {"a.txt": "alpha\r\n", NESTED_PATH: "beta"})])
    rid = w.keys["base"]["revision"]
    rv = revision(w, "dev", rid)
    key = f"archives/{w.repo_id}/{rid}.zip"
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url(f"/revisions/{rid}"))
        btn = pg.get_by_role("button", name="Export archive")
        soon(btn, ACT_MS).to_be_visible()
        ready(btn).focus()
        pg.keyboard.press("Enter")
        soon(action(pg), ACT_MS).to_contain_text(f"Archive saved to {key}")
        assert key in S3().keys(f"archives/{w.repo_id}/")
    z = zipfile.ZipFile(io.BytesIO(S3().get(key)))
    prefix = f"{c.repo}-{rid}/"
    assert sorted((n for n in z.namelist() if not n.endswith("/")), key=bkey) == sorted([prefix + "a.txt", prefix + NESTED_PATH, prefix + "REVISION.txt"], key=bkey)
    assert z.read(prefix + "a.txt") == b"alpha\r\n" and z.read(prefix + NESTED_PATH) == b"beta"
    lines = z.read(prefix + "REVISION.txt").decode().split("\n")
    assert lines[:4] == [f"revision: {rid}", f"parents: {', '.join(rv['parents'])}", f"author: {c.n('dev')}", f"message: {message}"]
    assert re.fullmatch(r"time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", lines[4]) and lines[5] == f"files: {len(rv['files'])}"
    err(w.api("dev", "POST", f"/revisions/{rid}/archive"), 403, {"error": "Only maintainers and owners can do that"})
    r = ok(w.api("owner", "POST", f"/revisions/{rid}/archive"), 201).json()
    assert r["key"] == key and r["revision"] == rid and r["entries"] == sorted(r["entries"], key=bkey) and prefix + "REVISION.txt" in r["entries"]


def test_wf_mail_and_archive_storage(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"n.txt": "note\n"})])
    parent = branch(w, "dev", "main")
    assert revision_id(["a1b2c3d4e5f6"], "Add greeting", {"docs/a.txt": b"hi\n", "src/b.txt": b"x"}) == "f144465d88df"
    crlf = b"\xef\xbb\xbfa \r\nb\t\r\n"
    body = {"branch": "main", "expected_head": parent, "message": "Store exactly",
            "files": [{"path": CRLF_PATH, "content_base64": base64.b64encode(crlf).decode()}, {"path": PLAIN_PATH, "content": "no final newline"}]}
    rid = ok(w.api("dev", "POST", "/push", body), 201).json()["revision"]
    assert rid == revision_id([parent], "Store exactly", {"n.txt": b"note\n", CRLF_PATH: crlf, PLAIN_PATH: b"no final newline"})
    assert raw_file(w, "dev", rid, CRLF_PATH) == crlf and S3().get("objects/" + hashlib.sha256(crlf).hexdigest()) == crlf
    assert {"path": CRLF_PATH, "size": len(crlf)} in revision(w, "dev", rid)["files"]
    down = os.environ.get("APP_MINIO_DOWN_URL")
    assert down, "APP_MINIO_DOWN_URL must name the storage outage instance"
    dusers = down_login(down, c, "owner")
    dw = lambda method, tail, b=None: api(down, method, f"/api/repos/{c.org}/{c.repo}{tail}", dusers["owner"], b)
    err(dw("POST", "/push", {"branch": "main", "expected_head": rid, "message": "Nope", "files": [{"path": "z.txt", "content": "z"}]}), 503, {"error": OUTAGE_PUSH})
    assert dw("GET", "/branches/main").json()["revision"] == rid
    err(dw("POST", f"/revisions/{rid}/archive"), 503, {"error": OUTAGE_EXPORT})
    err(dw("GET", f"/revisions/{rid}/files/n.txt"), 503, {"error": OUTAGE_PUSH})
    health = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    typed = f"typed-{c.tag}"
    with as_user(browser, w, "owner", base=down, users=dusers) as pg:
        pg.goto(f"{down}{w.path(f'/revisions/{rid}')}")
        strip = pg.get_by_role("alert", name="Announcement")
        soon(strip, ACT_MS).to_contain_text(OUTAGE_PUSH)
        click(pg.get_by_role("button", name="Export archive"))
        soon(strip, ACT_MS).to_contain_text(OUTAGE_EXPORT)
        pg.goto(f"{down}{w.path('/edit/main/n.txt')}")
        fill(pg.get_by_role("textbox", name="File content"), typed)
        fill(pg.get_by_role("textbox", name="Revision message"), f"offline-{c.tag}")
        click(pg.get_by_role("button", name="Save file"))
        soon(strip, ACT_MS).to_contain_text(OUTAGE_PUSH)
        soon(pg.get_by_role("textbox", name="File content")).to_have_value(typed)
    assert branch(w, "dev", "main") == rid
    assert not S3().keys(f"archives/{w.repo_id}/")


def test_wf_cross_cutting_screens(browser, app_url):
    c = Cast("owner", "dev", "rev", "lone")
    created = f"Created-{c.tag}"
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "café\n"}), S_push("dev", "feat", "feat", "E", {"a.txt": "café2\n"}, frm="main"), S_change("dev", "c1", "Inbox me", "feat"),
             S_push("dev", "spare", "spare", "Spare", {"s.txt": "s\n"}, frm="main"), {"as": "dev", "key": "rr", "request_review": {"change": "c1", "username": c.n("rev")}}]
    w = make_world(app_url, c, steps, roles={"lone": None})
    rid = w.keys["base"]["revision"]
    with as_user(browser, w, "rev") as pg:
        pg.goto(app_url + "/inbox")
        soon(pg.get_by_role("link", name=re.compile("Inbox me")), ACT_MS).to_be_visible()
        soon(pg.get_by_text(f"{c.n('dev')} • {c.org}/{c.repo}")).to_be_visible()
        pg.goto(w.url())
        soon(pg.get_by_role("combobox", name="Branch"), ACT_MS).to_be_visible()
        for name in ("Files", "Open changes", "Recent revisions"):
            soon(pg.get_by_role("list", name=name)).to_be_visible()
        soon(pg.get_by_role("link", name="New change")).to_be_visible()
        pg.goto(w.url("/blob/main/a.txt"))
        soon(pg.get_by_role("region", name="File content"), ACT_MS).to_have_attribute("data-byte-length", str(len("café\n".encode())))
        soon(pg.get_by_role("link", name="Raw")).to_be_visible()
        soon(pg.get_by_role("link", name="Edit file")).to_be_visible()
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url(f"/revisions/{rid}"))
        soon(pg.get_by_role("button", name="Export archive"), ACT_MS).to_be_visible()
    with as_user(browser, w, "dev") as pg:
        pg.goto(w.url("/changes/new"))
        fill(pg.get_by_role("textbox", name="Title"), created)
        fill(pg.get_by_role("textbox", name="Description"), "Body")
        select(pg.get_by_role("combobox", name="Head branch"), "spare")
        select(pg.get_by_role("combobox", name="Base branch"), "main")
        turn_on(pg.get_by_role("checkbox", name="Open as draft"))
        click(pg.get_by_role("button", name="Create change"))
        soon(pg, ACT_MS).to_have_url(re.compile(rf"/{re.escape(c.org)}/{re.escape(c.repo)}/changes/\d+(\?[^#]*)?$"))
        soon(pg.get_by_text(re.compile(rf"#\d+ {re.escape(created)}")).first, ACT_MS).to_be_visible()
        open_change(pg, w, 1)
        fill(pg.get_by_role("textbox", name="Reviewer username"), c.n("owner"))
        click(pg.get_by_role("button", name="Request review"))
        soon(action(pg), ACT_MS).to_contain_text(f"Review requested from {c.name('owner')}.")
        soon(pg.get_by_role("list", name="Requested reviewers")).to_contain_text(re.compile(f"{re.escape(c.name('owner'))}|{re.escape(c.n('owner'))}"))
        ghost = f"ghost{c.tag}"
        fill(pg.get_by_role("textbox", name="Reviewer username"), ghost)
        click(pg.get_by_role("button", name="Request review"))
        soon(pg.get_by_role("alert").filter(has_text=not_found_user(ghost)), ACT_MS).to_be_visible()
    assert any(ch["title"] == created and ch["state"] == "draft" for ch in ok(w.api("dev", "GET", "/changes"), 200).json())
    with as_user(browser, w, "lone") as pg:
        pg.goto(app_url + "/repos")
        soon(pg.get_by_role("textbox", name="Organisation address"), ACT_MS).to_be_visible()
        for name in ("Organisation address", "Organisation name", "Repository name"):
            soon(pg.get_by_role("textbox", name=name)).to_be_visible()
        pg.goto(app_url + "/inbox")
        soon(pg.get_by_text("Nothing is waiting for your review."), ACT_MS).to_be_visible()
        soon(pg.get_by_text("You have no unmerged changes.")).to_be_visible()


def test_wf_cross_cutting_platform(app_url):
    assert ok(httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT), 200).json() == {"status": "ok"}
    err(httpx.get(app_url + f"/api/nope-{uuid.uuid4().hex}", timeout=HTTP_TIMEOUT), 404, {"error": "Not found"})
    assert httpx.post(app_url + "/api/grading/setup", json={}, timeout=HTTP_TIMEOUT).status_code == 404
    c = Cast("owner")
    w = make_world(app_url, c, [])
    for path in ("/package.json", "/.env", "/src/server.ts"):
        r = httpx.get(app_url + path, headers={"Cookie": f"{COOKIE}={w.users['owner']['cookie']}"}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, path
    err(httpx.get(app_url + "/api/me", timeout=HTTP_TIMEOUT), 401, {"error": "Authentication required"})
    me = ok(api(app_url, "GET", "/api/me", w.users["owner"]), 200).json()
    assert me == {"username": c.n("owner"), "name": c.name("owner"), "email": c.people["owner"]["email"]}
    r = ok(api(app_url, "POST", "/api/login", body={"email": c.people["owner"]["email"], "password": PASSWORD}), 200)
    cookie = " ".join(r.headers.get_list("set-cookie")).lower()
    assert f"{COOKIE}=" in cookie and HTTP_ONLY in cookie


def test_wf_cross_cutting_responsive(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    rid = w.keys["base"]["revision"]
    signed_in = ["/inbox", "/repos", f"/{c.org}"] + [w.path(t) for t in ("", "/changes", "/changes/new", "/changes/1", "/queue", "/settings", "/blob/main/a.txt", "/edit/main/a.txt", f"/revisions/{rid}")]
    for size in (PHONE, TABLET, WIDE):
        with as_user(browser, w, "owner", size=size) as pg:
            for tail in signed_in:
                pg.goto(app_url + tail)
                soon(pg.get_by_role("navigation", name="Workspace"), ACT_MS).to_be_visible()
                layout(pg)
                if size["width"] < TAP_BREAKPOINT_PX:
                    assert small_controls(pg) == [], (size, tail)
        with as_user(browser, None, None, size=size, base=app_url) as pg:
            for tail in ("/", "/login", "/signup"):
                pg.goto(app_url + tail)
                soon(pg.get_by_role("navigation", name="Workspace"), ACT_MS).to_be_visible()
                layout(pg)


def test_wf_cross_cutting_motion(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    for reduced in ("no-preference", "reduce"):
        for label, tail in ((None, "/"), ("rev", w.path("/changes/1"))):
            with as_user(browser, w if label else None, label, reduced=reduced, base=app_url) as pg:
                pg.goto(app_url + tail)
                soon(pg.get_by_role("navigation", name="Workspace"), ACT_MS).to_be_visible()
                assert pg.evaluate(LOOPS_JS) == 0
                if reduced == "reduce":
                    settle_page(pg, lambda: pg.evaluate(RUNNING_JS) == 0, "no running animation under reduced motion")


def test_seed_data_harbor(app_url):
    r = ok(post_json(app_url, "/api/login", {"email": "mira@harbor.example", "password": PASSWORD}), 200)
    user = {"cookie": r.cookies.get(COOKIE) or re.search(rf"{COOKIE}=([^;]+)", r.headers["set-cookie"]).group(1)}
    g = lambda tail: api(app_url, "GET", f"/api/repos/harbor/harbor-ledger{tail}", user)
    repo = ok(g(""), 200).json()
    assert repo["settings"] == {"required_approvals": 1, "required_checks": ["lint", "unit"], "queue": True} and repo["visibility"] == "private"
    ch = {n: ok(g(f"/changes/{n}"), 200).json() for n in (1, 2)}
    assert (ch[1]["title"], ch[2]["title"], ch[2]["base"]) == ("Round totals to cents", "Use fixed rate", "round-totals")
    head = ok(g("/branches/main"), 200).json()["revision"]
    assert ok(g(f"/revisions/{head}/files/.review/OWNERS"), 200).content == b"* @tomas\n/src/rates.ts @harbor/payments\n"
    assert ok(g(f"/revisions/{head}/files/README.md"), 200).content == b"# harbor-ledger\n"
    pub = ok(api(app_url, "GET", "/api/repos/tidepool/tidepool-api", user), 200).json()
    assert pub["visibility"] == "public" and pub["settings"]["queue"] is False


def test_seed_nav_pill(browser, app_url):
    c = Cast("owner")
    w = make_world(app_url, c, [])
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(app_url)
        nav = pg.get_by_role("navigation", name="Workspace")
        for name in ("Log in", "Sign up", "Ridgestack"):
            soon(nav.get_by_role("link", name=name), ACT_MS).to_be_visible()
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        settle_page(pg, lambda: abs(nav.bounding_box()["y"] - NAV_GAP_PX) <= 2, "nav pill stuck 10 pixels below the top after scrolling")
    with as_user(browser, w, "owner") as pg:
        pg.goto(app_url + "/inbox")
        nav = pg.get_by_role("navigation", name="Workspace")
        for name in ("Inbox", "Repositories", "Ridgestack"):
            soon(nav.get_by_role("link", name=name), ACT_MS).to_be_visible()
        soon(nav.get_by_role("button", name="Log out")).to_be_visible()


def test_seed_home_hero(browser, app_url):
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(app_url)
        h1 = pg.get_by_role("heading", level=1, name="Stacks that keep their approvals")
        soon(h1, ACT_MS).to_be_visible()
        player = pg.get_by_role("region", name="Revision player")
        h1_box, player_box = h1.bounding_box(), player.bounding_box()
        assert player_box["x"] >= h1_box["x"] + h1_box["width"] - 1
        soon(pg.get_by_role("link", name="Open a workspace")).to_have_attribute("href", "/signup")
        click(pg.get_by_role("link", name="Read the push API"))
        settle_page(pg, lambda: pg.get_by_role("heading", name="Push API").evaluate("el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }"),
                    "Push API heading scrolled into view")
        pill = pg.get_by_role("link", name="Start a stack")
        pill.scroll_into_view_if_needed()
        box = pill.bounding_box()
        radius = pill.evaluate("el => parseFloat(getComputedStyle(el).borderRadius)")
        assert radius >= box["height"] / 2 - 1
        assert style(pill, "box-shadow")["box-shadow"] == "none"
        soon(pill).to_have_attribute("href", "/signup")
        pg.set_viewport_size(PHONE)
        pg.goto(app_url)
        assert player.bounding_box()["y"] > h1.bounding_box()["y"]
        layout(pg)


def test_seed_home_bento_footer(browser, app_url):
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(app_url)
        soon(pg.get_by_role("heading", name="Push API"), ACT_MS).to_be_visible()
        for text in ("harbor-ledger", "tidepool-api", "(required)", "Approvals", "Code owners", "Required checks", "Merge queue", "Restack"):
            assert pg.get_by_text(text).count() >= 1, text
        status = pg.get_by_role("status", name="Service status")
        status.scroll_into_view_if_needed()
        soon(status).to_have_text(re.compile(r"All services are running|Some services are unavailable"))
        mark = pg.get_by_role("img", name="Ridgestack neon wordmark")
        mark.scroll_into_view_if_needed()
        soon(mark).to_be_visible()
        assert mark.bounding_box()["width"] > pg.viewport_size["width"] / 2
        for size in (PHONE, TABLET, WIDE):
            pg.set_viewport_size(size)
            layout(pg)


def test_seed_revision_player(browser, app_url):
    pick = "(n) => [...document.querySelectorAll('[role=\"tab\"]')].findIndex((t) => t.getAttribute('aria-selected') === 'true') + 1 === n"
    with as_user(browser, None, None, base=app_url) as pg:
        pg.goto(app_url)
        player = pg.get_by_role("region", name="Revision player")
        tabs = player.get_by_role("tablist", name="Revisions").get_by_role("tab")
        soon(tabs, ACT_MS).to_have_count(5)
        player.scroll_into_view_if_needed()
        until(pg, pick, 5)
        advance(pg, 10000)
        assert pg.evaluate(pick, 5)
        click(tabs.nth(2))
        soon(tabs.nth(2)).to_have_attribute("aria-selected", "true")
        click(player.get_by_role("button", name="Play"))
        until(pg, pick, 5)
    with as_user(browser, None, None, base=app_url, reduced="reduce") as pg:
        pg.goto(app_url)
        player = pg.get_by_role("region", name="Revision player")
        soon(player.get_by_role("tab").first, ACT_MS).to_be_visible()
        selected = "() => [...document.querySelectorAll('[role=\"tab\"]')].findIndex((t) => t.getAttribute('aria-selected') === 'true')"
        player.scroll_into_view_if_needed()
        before = pg.evaluate(selected)
        advance(pg, 10000)
        assert pg.evaluate(selected) == before


def test_seed_merge_buttons(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c, settings={"required_approvals": 0, "required_checks": []})
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        merge = merge_box(pg).get_by_role("button", name="Merge change")
        soon(merge).to_be_enabled()
        rest, hover = glow_layers(merge), glow_layers(merge, "hover")
        assert has_halo(rest) and rest != hover, (rest, hover)
        assert style(pg.get_by_role("button", name="Review changes"), "box-shadow")["box-shadow"] == "none"


def test_seed_secondary_actions(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        btn = pg.get_by_role("button", name="Request review")
        rest, hover = state_styles(btn, "background-color", "border", state="hover")
        assert rest != hover
        seconds = [float(x) for x in re.findall(r"[\d.]+(?=s)", style(btn, "transition")["transition"])]
        assert seconds and 0 < max(seconds) <= HOVER_MAX_S
        field = pg.get_by_role("textbox", name="Reviewer username")
        pg.mouse.move(0, 0)
        settle(field)
        rest = field.evaluate(RING_JS)
        ready(field).focus()
        settle(field)
        assert rest != field.evaluate(RING_JS)


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(data.get(k), str) and data[k].strip(), k


def test_if_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text().lower()
    missing = [p.name for p in shipped_packages() if p.name.lower() not in notices]
    assert not missing, missing
    assert all(f.lower() in notices for f in FONTS)


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_services_only():
    found = {p.name for p in shipped_packages()} & FORBIDDEN_PACKAGES
    assert not found, found


def test_if_same_origin_pages(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    seen = []
    for label, tails in ((None, ["/", "/login", "/signup"]), ("dev", [w.path("/changes/1"), w.path("/queue"), "/inbox"])):
        with as_user(browser, w if label else None, label, base=app_url) as pg:
            pg.on("request", lambda rq: seen.append(rq.url))
            for tail in tails:
                pg.goto(app_url + tail)
                soon(pg.get_by_role("navigation", name="Workspace"), ACT_MS).to_be_visible()
    outside = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not outside, outside


def test_if_no_secrets_in_assets(app_url):
    sent = [GRADING_KEY]
    for name in ("DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "MAILPIT_URL"):
        value = os.environ.get(name, "")
        if len(value) >= 8 and value not in LOOPBACK_HOSTS:
            sent.append(value)
    bundled = [*sent, "America/Denver", "review@ridgestack.example"]
    todo, seen, pages = [app_url + "/"], set(), 0
    while todo and len(seen) < 40:
        url = todo.pop(0)
        if url in seen:
            continue
        seen.add(url)
        r = httpx.get(url, timeout=HTTP_TIMEOUT)
        if r.status_code != 200:
            continue
        asset = urlsplit(url).path.endswith(ASSET_SUFFIXES)
        pages += not asset
        leaked = [s for s in (bundled if asset else sent) if s in r.text]
        assert not leaked, (url, "secret value served")
        for found in ASSET_REF.findall(r.text):
            target = urljoin(url, next(part for part in found if part))
            if urlsplit(target).path.endswith(ASSET_SUFFIXES) and same_origin(target, app_url):
                todo.append(target.split("#")[0])
    assert pages, "the home page was not served"


def test_if_service_config_untouched():
    stray = [k for k in S3().keys() if not k.startswith(("objects/", "archives/"))]
    assert not stray, stray


GA_SHIFT = "a\nx\nb\nC\nd\ne\n"
GA_FIVE = "five changed"
GA_LOW = "feat1"
GA_TOP = "feat2"
GA_MAIN = "main.ts"
GA_SRC = ["src/ledger.ts", "src/rates.ts"]
GA_DOC = "docs/guide.md"


def ga_press(control):
    soon(control).to_be_enabled()
    ready(control).focus()
    control.page.keyboard.press("Enter")


def ga_section(pg, path):
    return pg.locator("[data-viewed]").filter(has=pg.get_by_role("table", name=f"Diff of {path}"))


def ga_rule_conflicts(branch_name, *paths):
    return f"Conflicts with {branch_name}: " + ", ".join(sorted(paths, key=bkey))


def ga_dismiss_world(base, c):
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "a\nb\nc\nd\n", "b.txt": "1\n"}),
             S_push("dev", "feat", "feat", "Edit", {"a.txt": "a\nb\nc\nd\ne\n", "b.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "Push me", "feat"), S_review("rev", "r1", "c1", "approve"),
             S_thread("rev", "tb", "c1", "a.txt", 2, f"keep-{c.tag}"), S_thread("rev", "tc", "c1", "a.txt", 3, f"gone-{c.tag}"),
             {"as": "rev", "key": "vb", "viewed": {"change": "c1", "path": "b.txt"}}]
    return make_world(base, c, steps)


def ga_two_stack(base, c):
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", "b.txt": "1\n"}),
             S_push("dev", "p1", GA_LOW, "One", {"b.txt": "B1\n"}, frm="main"), S_change("dev", "c1", "One", GA_LOW),
             S_push("dev", "p2", GA_TOP, "Two", {"a.txt": "2\n"}, frm=GA_LOW), S_change("dev", "c2", "Two", GA_TOP, GA_LOW),
             S_review("rev", "r2", "c2", "approve"), {"as": "rev", "key": "v2", "viewed": {"change": "c2", "path": "a.txt"}}]
    return make_world(base, c, steps)


def test_wf_keyboard_review_cross_file_comment(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    body = f"second-{c.tag}"
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        open_change(author, w)
        open_change(rev, w)
        for key in ("j", "j", "ArrowUp"):
            rev.keyboard.press(key)
        soon(row(rev, "a.txt", unchanged(3, "l3"))).to_have_attribute("data-cursor", "true")
        soon(row(rev, "a.txt", unchanged(3, "l3"))).to_be_focused()
        soon(row(rev, "b.txt", added(1, "x"))).not_to_have_attribute("data-cursor", "true")
        for key in ("ArrowDown", "ArrowDown"):
            rev.keyboard.press(key)
        cursor = row(rev, "b.txt", added(2, "y"))
        soon(cursor).to_be_focused()
        rev.keyboard.press("c")
        dlg = rev.get_by_role("dialog", name=comment_dialog("b.txt", 2))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_focused()
        rev.keyboard.type(body)
        rev.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(cursor).to_be_focused()
        live = thread(author, "b.txt", 2)
        soon(live, LIVE_MS).to_contain_text(body)
        for name, value in (("data-path", "b.txt"), ("data-side", "new"), ("data-line", "2"), ("data-state", "unresolved"), ("data-outdated", "false")):
            soon(live).to_have_attribute(name, value)
        soon(updates(author), LIVE_MS).to_contain_text(ann_comment(1, c.name("rev")))
        soon(author.get_by_text("Unresolved threads: 1"), LIVE_MS).to_be_visible()


def test_wf_keyboard_review_shortcut_review_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        open_change(author, w)
        open_change(rev, w)
        rev.keyboard.press("j")
        cursor = row(rev, "a.txt", unchanged(1, "l1"))
        soon(cursor).to_be_focused()
        rev.keyboard.press("r")
        dlg = rev.get_by_role("dialog", name="Submit review")
        soon(dlg.get_by_role("radio").first).to_be_focused()
        turn_on(dlg.get_by_role("radio", name="Request changes"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"order-{c.tag}")
        rev.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(rule_items(author), LIVE_MS).to_have_count(3)
        for i, rule in enumerate(("approvals", "changes-requested", "checks")):
            soon(rule_items(author).nth(i)).to_have_attribute("data-rule", rule)
        for pg in (author, rev):
            soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("rev"), "requested changes"))
        report(w, "dev", head, "lint", "success")
        for pg in (author, rev):
            soon(rule_items(pg).filter(has_text="Required checks not passed"), LIVE_MS).to_have_count(0)
            soon(updates(pg), LIVE_MS).to_contain_text(ann_check(1, "lint", "success"))
        soon(rule_items(author)).to_have_text([rule_approvals(1, 0), rule_changes(c.name("rev"))])


def test_wf_suggestion_batch_keyboard_suggestion_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev", reduced="reduce") as rev:
        open_change(author, w)
        open_change(rev, w)
        watch(author, "data-thread-id")
        watch(rev, "data-thread-id")
        for key in ("j", "j", "c"):
            rev.keyboard.press(key)
        dlg = rev.get_by_role("dialog", name=comment_dialog("b.txt", 1))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_focused()
        rev.keyboard.type(f"swap-{c.tag}")
        turn_on(dlg.get_by_role("checkbox", name="Add a suggestion"))
        fill(dlg.get_by_role("textbox", name="Suggested lines"), f"swapped-{c.tag}")
        rev.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        art = thread(author, "b.txt", 1)
        region = art.get_by_role("region", name="Suggested change")
        soon(region.get_by_role("button", name="Apply suggestion"), LIVE_MS).to_be_visible()
        soon(region.get_by_role("button", name="Add to batch")).to_be_visible()
        soon(art, ACT_MS).to_have_attribute("data-anim", "none")
        soon(thread(rev, "b.txt", 1)).to_have_attribute("data-anim", "none")
        for pg in (author, rev):
            soon(updates(pg), LIVE_MS).to_contain_text(ann_comment(1, c.name("rev")))
        assert "entering" in anim_seen(author), anim_seen(author)
        assert "entering" not in anim_seen(rev), anim_seen(rev)


def test_wf_suggestion_batch_keyboard_batch_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = sugg_world(app_url, c)
    with as_user(browser, w, "rev") as rev, as_user(browser, w, "dev") as author:
        open_change(rev, w)
        open_change(author, w)
        arts = {k: author.locator("[data-thread-id]").filter(has_text=w.bodies[k]) for k in ("one", "two", "three")}
        apply_batch = author.get_by_role("button", name="Apply batch")
        ga_press(arts["three"].get_by_role("region", name="Suggested change").get_by_role("button", name="Add to batch"))
        soon(apply_batch).to_be_visible()
        ga_press(arts["three"].get_by_role("button", name="Remove from batch"))
        soon(arts["three"].get_by_role("button", name="Add to batch")).to_be_visible()
        soon(apply_batch).to_have_count(0)
        for k in ("one", "two"):
            ga_press(arts[k].get_by_role("region", name="Suggested change").get_by_role("button", name="Add to batch"))
            soon(arts[k].get_by_role("button", name="Remove from batch")).to_be_visible()
        ga_press(apply_batch)
        soon(action(author), ACT_MS).to_contain_text("Suggestions applied in revision ")
        rid = re.search(r"revision ([0-9a-f]{12})\.", action(author).inner_text()).group(1)
        soon(row(author, "f.txt", added(3, "THREE")), ACT_MS).to_be_visible()
        soon(row(author, "f.txt", added(5, "FOUR b"))).to_be_visible()
        soon(updates(rev), LIVE_MS).to_contain_text(f"#1: new revision {rid} from {c.name('dev')}, approvals ")
    rv = revision(w, "dev", rid)
    assert rv["message"] == msg_apply(2) and change_json(w, "dev", 1)["head_revision"] == rid


def test_wf_suggestion_batch_stale_batch_in_page(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = sugg_world(app_url, c)
    push(w, "dev", "feat", {"f.txt": f"one\nTWO\nthree\nfour\n{GA_FIVE}\n"})
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(row(pg, "f.txt", added(5, GA_FIVE))).to_be_visible()
        turn_on(pg.get_by_role("switch", name="Show outdated threads"))
        stale = pg.get_by_role("region", name="Outdated threads").locator("[data-thread-id]").filter(has_text=w.bodies["three"])
        soon(stale).to_have_attribute("data-outdated", "true")
        fresh = pg.locator("[data-thread-id]").filter(has_text=w.bodies["one"])
        soon(fresh).to_have_attribute("data-outdated", "false")
        for art in (fresh, stale):
            ga_press(art.get_by_role("region", name="Suggested change").get_by_role("button", name="Add to batch"))
            soon(art.get_by_role("button", name="Remove from batch")).to_be_visible()
        ga_press(pg.get_by_role("button", name="Apply batch"))
        soon(pg.get_by_role("alert", name="Announcement"), ACT_MS).to_contain_text(stale_suggestion(5))
        soon(row(pg, "f.txt", added(3, "THREE"))).to_have_count(0)
    assert change_json(w, "dev", 1)["head_revision"] == head


def test_wf_push_dismisses_threads_follow(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = ga_dismiss_world(app_url, c)
    tb, tc = w.keys["tb"]["id"], w.keys["tc"]["id"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        soon(thread(pg, "a.txt", 2)).to_have_attribute("data-thread-id", str(tb))
        rid = push(w, "dev", "feat", {"a.txt": GA_SHIFT})["revision"]
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        pg.reload()
        moved = pg.locator(f'[data-thread-id="{tb}"]')
        soon(moved, ACT_MS).to_have_attribute("data-line", "3")
        soon(pg.get_by_role("article", name=thread_name("a.txt", 3)).filter(has_text=f"keep-{c.tag}")).to_have_count(1)
        soon(pg.locator(f'[data-thread-id="{tc}"]')).to_be_hidden()
        soon(pg.get_by_text("Unresolved threads: 2")).to_be_visible()
        for _ in range(2):
            pg.keyboard.press("n")
            soon(moved).to_be_focused()
        soon(row(pg, "a.txt", unchanged(3, "b"))).to_have_attribute("data-cursor", "true")
        turn_on(pg.get_by_role("switch", name="Show outdated threads"))
        old = pg.get_by_role("region", name="Outdated threads").locator(f'[data-thread-id="{tc}"]')
        soon(old).to_have_attribute("data-outdated", "true")
        soon(old).to_contain_text(f"gone-{c.tag}")


def test_wf_push_dismisses_viewed_by_key(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = ga_dismiss_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        soon(pg.get_by_text("1 of 2 files viewed")).to_be_visible()
        pg.keyboard.press("j")
        cursor = row(pg, "a.txt", unchanged(2, "b"))
        soon(cursor).to_be_focused()
        pg.keyboard.press("v")
        soon(ga_section(pg, "a.txt"), ACT_MS).to_have_attribute("data-viewed", "true")
        soon(pg.get_by_text("2 of 2 files viewed"), ACT_MS).to_be_visible()
        soon(cursor).to_be_focused()
        rid = push(w, "dev", "feat", {"a.txt": GA_SHIFT})["revision"]
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        soon(ga_section(pg, "a.txt")).to_have_attribute("data-viewed", "false")
        soon(ga_section(pg, "a.txt").get_by_role("checkbox", name="Viewed")).not_to_be_checked()
        soon(ga_section(pg, "b.txt")).to_have_attribute("data-viewed", "true")
        soon(pg.get_by_text("1 of 2 files viewed")).to_be_visible()
        review = pg.get_by_role("list", name="Reviews").get_by_role("listitem").first
        soon(review).to_have_attribute("data-state", "dismissed")
        soon(review).to_contain_text("Dismissed: the change was updated after this approval")
        soon(rule_items(pg)).to_have_text([rule_approvals(1, 0)])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "approvals")
        soon(pg.get_by_text("Approvals remaining: 1")).to_be_visible()


def test_wf_restack_keeps_approval_viewed_and_box(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = ga_two_stack(app_url, c)
    old = change_json(w, "rev", 2)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 2)
        viewed = pg.get_by_role("checkbox", name="Viewed")
        soon(viewed).to_be_checked()
        soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        push(w, "dev", GA_LOW, {"b.txt": "9\n"})
        soon(updates(pg), ACT_MS).to_contain_text(ann_restack(2, 1, True))
        soon(stack_row(pg, 2)).to_have_attribute("data-restack", "kept")
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        soon(viewed).to_be_checked()
        soon(pg.get_by_text("1 of 1 files viewed")).to_be_visible()
        soon(pg.get_by_role("list", name="Reviews").get_by_role("listitem").first).to_have_attribute("data-state", "approved")
        soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "met")
        soon(merge_box(pg).get_by_role("button", name="Merge change")).to_be_enabled()
    ch = change_json(w, "rev", 2)
    rv = revision(w, "rev", ch["head_revision"])
    assert rv["message"] == msg_restack(1) and rv["parents"] == [old]
    assert ch["counts"]["files_viewed"] == 1


def test_wf_restack_keeps_approval_conflict_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = ga_two_stack(app_url, c)
    head = change_json(w, "rev", 2)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w, 2)
        soon(rule_items(pg).first).to_have_attribute("data-rule", "met")
        push(w, "dev", GA_LOW, {"a.txt": "3\n"})
        notice = pg.get_by_role("region", name="Change notices").get_by_role("listitem")
        soon(notice, ACT_MS).to_have_attribute("data-notice", "restack-stopped")
        soon(notice).to_contain_text(notice_stopped(1, "a.txt"))
        soon(rule_items(pg), LIVE_MS).to_have_text([ga_rule_conflicts(GA_LOW, "a.txt")])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "conflicting")
        soon(merge_box(pg).get_by_role("button", name="Merge change")).to_be_disabled()
        soon(stack_row(pg, 2)).to_have_attribute("data-restack", "conflicting")
        soon(stack_row(pg, 2)).to_contain_text(word_conflicts(1))
        soon(updates(pg)).to_contain_text(ann_conflict(2, 1))
        soon(pg.get_by_role("list", name="Reviews").get_by_role("listitem").first).to_have_attribute("data-state", "approved")
    assert change_json(w, "rev", 2)["head_revision"] == head


def test_wf_restack_keeps_approval_every_viewer(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = ga_two_stack(app_url, c)
    with as_user(browser, w, "rev") as low, as_user(browser, w, "owner", reduced="reduce") as top:
        open_change(low, w, 1)
        open_change(top, w, 2)
        for pg in (low, top):
            watch(pg, "data-change-number")
        pushed = push(w, "dev", GA_LOW, {"b.txt": "9\n"})["revision"]
        for pg in (low, top):
            soon(updates(pg), ACT_MS).to_contain_text(ann_restack(2, 1, True))
            in_order(updates(pg).text_content(), [f"#1: new revision {pushed} from {c.name('dev')}, approvals ", ann_restack(2, 1, True)])
            soon(stack_row(pg, 2)).to_have_attribute("data-restack", "kept")
            soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        eventually(lambda: "walking" in anim_seen(low), "the top row walks on the bottom change's page")
        for pg in (low, top):
            soon(stack_row(pg, 2), ACT_MS).to_have_attribute("data-anim", "none")
            assert attr(stack_row(pg, 1), "data-restack") == ""
        assert "walking" not in anim_seen(top), anim_seen(top)


def test_wf_code_owners_last_line_live(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, owners_text(c), {p: "x\n" for p in ALL_OWNED})
    waiting = [p for p in ALL_OWNED if p != "vendor/x.js"]
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(rule_items(pg)).to_have_text([rule_owners(waiting)])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "code-owners")
        for who, gone in (("jonas", GA_SRC[1]), ("lena", GA_DOC)):
            ok(review_api(w, who, 1, "approve"), 201)
            waiting.remove(gone)
            soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name(who), "approved"))
            soon(rule_items(pg), LIVE_MS).to_have_text([rule_owners(waiting)])


def test_wf_code_owners_team_member_keyboard(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n/src/ @{c.org}/{c.team}\n", {GA_MAIN: "m\n", **{p: "s\n" for p in GA_SRC}})
    with as_user(browser, w, "dev") as author, as_user(browser, w, "tomas") as tomas:
        open_change(author, w)
        open_change(tomas, w)
        soon(rule_items(author)).to_have_text([rule_owners([GA_MAIN, *GA_SRC])])
        tomas.keyboard.press("j")
        cursor = row(tomas, GA_MAIN, added(1, "m"))
        soon(cursor).to_be_focused()
        dlg = tomas.get_by_role("dialog", name="Submit review")
        tomas.keyboard.press("r")
        soon(dlg.get_by_role("radio").first).to_be_focused()
        tomas.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_be_focused()
        tomas.keyboard.press("r")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"team-{c.tag}")
        tomas.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(rule_items(author), LIVE_MS).to_have_text([rule_owners([GA_MAIN])])
        for pg in (author, tomas):
            soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("tomas"), "approved"))


def test_wf_code_owners_push_adds_owner(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\ndocs/** @{c.n('lena')}\n", {GA_MAIN: "m\n"}, team=())
    with as_user(browser, w, "dev") as author, as_user(browser, w, "lena") as lena:
        open_change(author, w)
        open_change(lena, w)
        soon(rule_items(author)).to_have_text([rule_owners([GA_MAIN])])
        rid = push(w, "dev", "feat", {GA_DOC: "d\n"})["revision"]
        soon(updates(author), LIVE_MS).to_contain_text(f"#1: new revision {rid} from {c.name('dev')}, approvals ")
        for pg in (author, lena):
            soon(rule_items(pg), LIVE_MS).to_have_text([rule_owners([GA_MAIN, GA_DOC])])
        lena.keyboard.press("r")
        dlg = lena.get_by_role("dialog", name="Submit review")
        soon(dlg.get_by_role("radio").first).to_be_focused()
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"docs-{c.tag}")
        lena.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(updates(author), LIVE_MS).to_contain_text(ann_review(1, c.name("lena"), "approved"))
        soon(rule_items(author), LIVE_MS).to_have_text([rule_owners([GA_MAIN])])


def test_wf_code_owners_last_owner_enables_merge(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n/src/ @{c.org}/{c.team}\n", {GA_MAIN: "m\n", GA_SRC[0]: "s\n"})
    ok(review_api(w, "mira", 1, "approve"), 201)
    with as_user(browser, w, "dev") as author, as_user(browser, w, "tomas") as tomas:
        open_change(author, w)
        open_change(tomas, w)
        merge = merge_box(author).get_by_role("button", name="Merge change")
        soon(rule_items(author)).to_have_text([rule_owners([GA_SRC[0]])])
        soon(merge).to_be_disabled()
        ga_press(tomas.get_by_role("button", name="Review changes"))
        dlg = tomas.get_by_role("dialog", name="Submit review")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"last-{c.tag}")
        tomas.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(rule_items(author), LIVE_MS).to_have_text(["All merge rules are met"])
        soon(rule_items(author).first).to_have_attribute("data-rule", "met")
        soon(merge).to_be_enabled()
        ga_press(merge)
        soon(action(author), ACT_MS).to_contain_text("Change #1 merged.")
        for pg in (author, tomas):
            soon(updates(pg), LIVE_MS).to_contain_text(ann_merged(1))
    assert change_json(w, "dev", 1)["state"] == "merged"


def test_wf_code_owners_base_owners_after_push(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n", {GA_MAIN: "m\n"}, team=())
    owned = rule_owners([".review/OWNERS", GA_MAIN])
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(rule_items(pg)).to_have_text([rule_owners([GA_MAIN])])
        push(w, "dev", "feat", {".review/OWNERS": f"* @{c.n('lena')}\n"})
        soon(rule_items(pg), LIVE_MS).to_have_text([owned])
        ok(review_api(w, "lena", 1, "approve"), 201)
        soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("lena"), "approved"))
        soon(rule_items(pg)).to_have_text([owned])
        assert rules_of(w, "dev", 1)["code-owners"] == owned
        ok(review_api(w, "mira", 1, "approve"), 201)
        soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("mira"), "approved"))
        soon(rule_items(pg), LIVE_MS).to_have_text(["All merge rules are met"])


GB_EXTRA_CHECKS = ("audit", "Build")


def gb_checks(pg):
    return pg.get_by_role("list", name="Checks")


def gb_row(scope, name):
    return scope.locator(f'[data-check-name="{name}"]')


def gb_rule(pg, rule):
    return merge_box(pg).get_by_role("list", name="Merge rules").locator(f'[data-rule="{rule}"]')


def gb_conflicts(base_branch, *paths):
    return f"Conflicts with {base_branch}: " + ", ".join(paths)


def gb_notice(pg):
    return pg.get_by_role("region", name="Change notices").get_by_role("listitem")


def gb_history(pg, entry_id):
    return pg.get_by_role("table", name="Queue history").locator(f'[data-queue-entry-id="{entry_id}"]')


def gb_rail_link(pg, n):
    return pg.get_by_role("list", name="Stack").get_by_role("link", name=re.compile(rf"^#{n} "))


def gb_change_url(w, n):
    return re.compile(re.escape(w.path(f"/changes/{n}")) + "$")


def gb_press(control):
    soon(control).to_be_enabled()
    ready(control).focus()
    control.page.keyboard.press("Enter")


def gb_pair_world(base, c, queued=False):
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", "b.txt": "1\n"}),
             S_push("dev", "p1", "feat1", "One", {"a.txt": "2\n"}, frm="main"), S_change("dev", "c1", "One", "feat1"),
             S_push("dev", "p2", "feat2", "Two", {"b.txt": "2\n"}, frm="feat1"), S_change("dev", "c2", "Two", "feat2", "feat1"),
             S_check("dev", "k1", "p1", "unit", "success"), S_check("dev", "k2", "p2", "unit", "success")]
    if queued:
        steps.append(S_queue("dev", "e1", "c1"))
    return make_world(base, c, steps, settings={"required_approvals": 0, "required_checks": ["unit"], "queue": True})


def test_wf_check_lifecycle_announced(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        lint = gb_row(gb_checks(pg), "lint")
        soon(lint, ACT_MS).to_have_attribute("data-state", "queued")
        report(w, "dev", head, "lint", "queued")
        seq = []
        for state in ("in_progress", "failure", "success"):
            report(w, "dev", head, "lint", state)
            soon(updates(pg), LIVE_MS).to_contain_text(ann_check(1, "lint", state))
            soon(lint, LIVE_MS).to_have_attribute("data-state", state)
            soon(lint).to_contain_text(WORD[state])
            seq.append(ann_check(1, "lint", state))
        in_order(updates(pg).text_content(), seq)


def test_wf_check_lifecycle_latest_wins(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c, ("lint", "unit"))
    head = change_json(w, "dev", 1)["head_revision"]
    steps = (("failure", rule_checks(("lint", "failure"), ("unit", "queued"))), ("success", rule_checks(("unit", "queued"))),
             ("failure", rule_checks(("lint", "failure"), ("unit", "queued"))))
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        lint, unit = gb_row(gb_checks(pg), "lint"), gb_row(gb_checks(pg), "unit")
        for state, rule in steps:
            report(w, "dev", head, "lint", state)
            soon(lint, LIVE_MS).to_have_attribute("data-state", state)
            soon(lint).to_contain_text(WORD[state])
            soon(lint).not_to_contain_text("Times out at")
            soon(gb_rule(pg, "checks"), LIVE_MS).to_have_text(rule)
            soon(unit).to_have_attribute("data-state", "queued")
            soon(unit).to_contain_text("Times out at")
    assert rules_of(w, "dev", 1)["checks"] == rule_checks(("lint", "failure"), ("unit", "queued"))


def test_wf_check_lifecycle_merge_key(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c)
    head, title = change_json(w, "dev", 1)["head_revision"], change_json(w, "dev", 1)["title"]
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        for pg in (author, rev):
            open_change(pg, w)
            soon(gb_rule(pg, "checks")).to_have_text(rule_checks(("lint", "queued")))
            soon(merge_box(pg).get_by_role("button", name="Merge change")).to_be_disabled()
        report(w, "dev", head, "lint", "success")
        for pg in (author, rev):
            soon(rule_items(pg).first, LIVE_MS).to_have_attribute("data-rule", "met")
            soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        gb_press(merge_box(author).get_by_role("button", name="Merge change"))
        soon(action(author), ACT_MS).to_contain_text("Change #1 merged.")
        soon(updates(rev), LIVE_MS).to_contain_text(ann_merged(1))
    assert change_json(w, "dev", 1)["state"] == "merged"
    assert revision(w, "dev", branch(w, "dev", "main"))["message"] == msg_merge(1, title)


def test_wf_check_lifecycle_timeout_page(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c, ("lint", "unit"))
    head = change_json(w, "dev", 1)["head_revision"]
    report(w, "dev", head, "lint", "success")
    report(w, "dev", head, "unit", "in_progress")
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        unit, lint = gb_row(gb_checks(pg), "unit"), gb_row(gb_checks(pg), "lint")
        soon(unit, ACT_MS).to_have_attribute("data-state", "in_progress")
        soon(unit).to_contain_text("Times out at")
        clock(app_url, CHECK_TIMEOUT_SECONDS + 2)
        eventually(lambda: rules_of(w, "dev", 1).get("checks") == rule_checks(("unit", "timed_out")), "unit timed out on the server clock")
        err(w.api("dev", "POST", "/checks", {"revision": head, "name": "unit", "state": "success", "summary": "late"}), 409, {"error": "Check unit timed out"})
        pg.reload()
        soon(unit, ACT_MS).to_have_attribute("data-state", "timed_out")
        soon(unit).to_contain_text(WORD["timed_out"])
        soon(unit).not_to_contain_text("Times out at")
        soon(lint).to_have_attribute("data-state", "success")
        soon(lint).to_contain_text(WORD["success"])
        soon(gb_rule(pg, "checks")).to_have_text(rule_checks(("unit", "timed_out")))
        soon(merge_box(pg).get_by_role("button", name="Merge change")).to_be_disabled()


def test_wf_check_lifecycle_rows_order(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c, ("unit", "lint"))
    head = change_json(w, "dev", 1)["head_revision"]
    audit, build = GB_EXTRA_CHECKS
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        items = gb_checks(pg).get_by_role("listitem")
        soon(items, ACT_MS).to_have_count(2)
        report(w, "dev", head, audit, "in_progress")
        report(w, "dev", head, build, "success")
        soon(items, LIVE_MS).to_have_count(4)
        for i, name in enumerate(["lint", "unit", build, audit]):
            soon(items.nth(i)).to_have_attribute("data-check-name", name)
        extra = gb_row(gb_checks(pg), audit)
        soon(extra).to_have_attribute("data-state", "in_progress")
        soon(extra).to_contain_text(WORD["in_progress"])
        soon(extra).not_to_contain_text("Times out at")
        soon(gb_row(gb_checks(pg), "lint")).to_contain_text("Times out at")
        soon(gb_rule(pg, "checks")).to_have_text(rule_checks(("lint", "queued"), ("unit", "queued")))


def test_wf_stack_of_three_conflict_keys(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    heads = {n: change_json(w, "dev", n)["head_revision"] for n in (2, 3)}
    with as_user(browser, w, "rev", reduced="reduce") as pg:
        open_change(pg, w, 3)
        watch(pg, "data-change-number")
        push(w, "dev", "feat1", {"a.txt": "3\n"})
        soon(gb_notice(pg), ACT_MS).to_have_attribute("data-notice", "not-restacked")
        soon(gb_notice(pg)).to_contain_text(notice_not_restacked(2))
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "not_restacked")
        soon(stack_row(pg, 2)).to_have_attribute("data-restack", "conflicting")
        soon(stack_row(pg, 2)).to_have_attribute("data-anim", "none")
        assert "walking" not in anim_seen(pg)
        ready(gb_rail_link(pg, 3)).focus()
        pg.keyboard.press("ArrowUp")
        soon(gb_rail_link(pg, 2)).to_be_focused()
        pg.keyboard.press("Enter")
        soon(pg, ACT_MS).to_have_url(gb_change_url(w, 2))
        soon(gb_notice(pg), ACT_MS).to_have_attribute("data-notice", "restack-stopped")
        soon(gb_notice(pg)).to_contain_text(notice_stopped(1, "a.txt"))
        soon(gb_rule(pg, "conflicting")).to_have_text(gb_conflicts("feat1", "a.txt"))
        soon(stack_row(pg, 2)).to_contain_text(word_conflicts(1))
    assert {n: change_json(w, "dev", n)["head_revision"] for n in (2, 3)} == heads


def test_wf_stack_of_three_phone_tap(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c)
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w, 3)
        watch(pg, "data-change-number")
        pushed = push(w, "dev", "feat1", {"b.txt": "B9\n"})["revision"]
        soon(stack_row(pg, 3), ACT_MS).to_have_attribute("data-restack", "kept")
        walked = walked_rows(pg, 3)
        soon(stack_row(pg, 2)).to_contain_text("Approvals kept")
        assert walked == ["2", "3"] and pg.evaluate("() => window.__max") <= 1
        soon(updates(pg), ACT_MS).to_contain_text(ann_restack(3, 2, True))
        in_order(updates(pg).text_content(), [f"#1: new revision {pushed} from {c.name('dev')}, approvals ", ann_restack(2, 1, True), ann_restack(3, 2, True)])
        tap(gb_rail_link(pg, 1))
        soon(pg, ACT_MS).to_have_url(gb_change_url(w, 1))
        soon(stack_row(pg, 3), ACT_MS).to_contain_text("Approvals kept")
        soon(stack_row(pg, 2)).to_have_attribute("data-restack", "kept")
        assert attr(stack_row(pg, 1), "data-restack") == ""
        layout(pg)


def test_wf_stack_merge_retarget_enqueue_keys(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = gb_pair_world(app_url, c)
    main = branch(w, "dev", "main")
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, 2)
        gb_press(merge_box(pg).get_by_role("button", name="Add to merge queue"))
        soon(pg.get_by_role("alert", name="Announcement"), ACT_MS).to_contain_text("Only changes based on main can join the merge queue")
        open_change(pg, w, 1)
        gb_press(merge_box(pg).get_by_role("button", name="Add to merge queue"))
        soon(action(pg), ACT_MS).to_contain_text(queue_added(1))
        soon(merge_box(pg)).to_contain_text(queue_state(1))
    entries = queue_data(w)["entries"]
    assert len(entries) == 1 and change_json(w, "dev", 1)["state"] == "queued" and change_json(w, "dev", 2)["state"] == "open"
    rv = revision(w, "dev", entries[0]["revision"])
    assert rv["message"] == msg_queue(1, 1) and rv["parents"] == [main]


def test_wf_stack_merge_retarget_queue_rows(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = gb_pair_world(app_url, c, queued=True)
    eid, qrev = w.keys["e1"]["id"], w.keys["e1"]["revision"]
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        entry = qentry(pg, 1)
        soon(entry, ACT_MS).to_contain_text(f"Queue revision {qrev}")
        soon(entry).to_have_attribute("data-state", "waiting")
        unit = gb_row(entry, "unit")
        soon(unit).to_have_attribute("data-state", "queued")
        soon(unit).to_contain_text("Times out at")
        report(w, "dev", qrev, "unit", "in_progress")
        soon(unit, LIVE_MS).to_have_attribute("data-state", "in_progress")
        soon(unit).to_contain_text(WORD["in_progress"])
        soon(entry, LIVE_MS).to_have_attribute("data-state", "checking")
        report(w, "dev", qrev, "unit", "success")
        soon(unit, LIVE_MS).to_have_attribute("data-state", "success")
        soon(unit).to_contain_text(WORD["success"])
        soon(unit).not_to_contain_text("Times out at")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 1)["state"] == "merged", "change #1 merged by the queue step")
        pg.reload()
        soon(gb_history(pg, eid), ACT_MS).to_have_attribute("data-state", "merged")
        soon(pg.get_by_text("The merge queue is empty.")).to_be_visible()


def test_wf_stack_merge_retarget_new_head(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = gb_pair_world(app_url, c, queued=True)
    old = change_json(w, "dev", 2)["head_revision"]
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, 2)
        unit = gb_row(gb_checks(pg), "unit")
        soon(unit, ACT_MS).to_have_attribute("data-state", "success")
        report(w, "dev", w.keys["e1"]["revision"], "unit", "success")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 2)["base"] == "main", "change #2 retargeted after #1 merged")
        new = change_json(w, "dev", 2)["head_revision"]
        assert new != old and change_json(w, "dev", 1)["state"] == "merged"
        pg.reload()
        soon(gb_notice(pg), ACT_MS).to_have_attribute("data-notice", "base-changed")
        soon(gb_notice(pg)).to_contain_text(notice_base("main", 1))
        soon(unit).to_have_attribute("data-state", "queued")
        soon(gb_rule(pg, "checks")).to_have_text(rule_checks(("unit", "queued")))
        report(w, "dev", new, "unit", "success")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_check(2, "unit", "success"))
        soon(unit, LIVE_MS).to_have_attribute("data-state", "success")
        soon(rule_items(pg).first, LIVE_MS).to_have_attribute("data-rule", "met")
        gb_press(merge_box(pg).get_by_role("button", name="Add to merge queue"))
        soon(action(pg), ACT_MS).to_contain_text(queue_added(1))


def test_wf_queue_middle_fails_two_viewers(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    n2, n3 = w.num("c2"), w.num("c3")
    with as_user(browser, w, "owner") as cap, as_user(browser, w, "dev", reduced="reduce") as dev:
        for pg in (cap, dev):
            pg.goto(w.url("/queue"))
            soon(qentry(pg, n3), ACT_MS).to_have_attribute("data-position", "3")
            watch(pg, "data-queue-entry-id")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        for pg in (cap, dev):
            soon(qentry(pg, n3), LIVE_MS).to_have_attribute("data-position", "2")
            soon(qentry(pg, n2), LIVE_MS).to_have_count(0)
            soon(updates(pg), LIVE_MS).to_contain_text(ann_position(n3, 2))
            soon(updates(pg), LIVE_MS).to_contain_text(ann_reason(n2, removed_failed("unit")))
            soon(qentry(pg, n3), ACT_MS).to_have_attribute("data-anim", "none")
        assert "moving" in anim_seen(cap) and "moving" not in anim_seen(dev)


def test_wf_queue_middle_fails_reset(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids, r3 = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}, w.keys["e3"]["revision"]
    report(w, "dev", r3, "unit", "success")
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        third = qentry(pg, w.num("c3"))
        soon(third, ACT_MS).to_have_attribute("data-state", "checking")
        soon(gb_row(third, "unit")).to_have_attribute("data-state", "success")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        soon(third, LIVE_MS).to_have_attribute("data-position", "2")
        soon(third, LIVE_MS).to_have_attribute("data-state", "waiting")
        new = entry_of(queue_data(w), ids[3])["revision"]
        assert new != r3
        pg.reload()
        soon(third, ACT_MS).to_contain_text(f"Queue revision {new}")
        soon(third).not_to_contain_text(r3)
        soon(gb_row(third, "unit")).to_have_attribute("data-state", "queued")
        soon(gb_row(third, "unit")).to_contain_text("Times out at")
        soon(gb_history(pg, ids[2])).to_have_attribute("data-state", "removed")
        soon(gb_history(pg, ids[2])).to_contain_text(removed_failed("unit"))


def test_wf_queue_middle_fails_head_merges(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        head, third = qentry(pg, w.num("c1")), qentry(pg, w.num("c3"))
        soon(third, ACT_MS).to_have_attribute("data-position", "3")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        soon(third, LIVE_MS).to_have_attribute("data-position", "2")
        report(w, "dev", w.keys["e1"]["revision"], "unit", "success")
        soon(head, LIVE_MS).to_have_attribute("data-state", "checking")
        soon(gb_row(head, "unit"), LIVE_MS).to_have_attribute("data-state", "success")
        r3 = entry_of(queue_data(w), ids[3])["revision"]
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 1)["state"] == "merged", "change #1 merged at the queue step")
        pg.reload()
        soon(gb_history(pg, ids[1]), ACT_MS).to_have_attribute("data-state", "merged")
        soon(third).to_have_attribute("data-position", "1")
        soon(third).to_contain_text(f"Queue revision {r3}")
    assert entry_of(queue_data(w), ids[3])["revision"] == r3


def test_wf_queue_middle_fails_author_page(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    n2 = w.num("c2")
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, n2)
        soon(merge_box(pg)).to_contain_text(queue_state(2))
        report(w, "dev", w.keys["e2"]["revision"], "unit", "failure")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_reason(n2, removed_failed("unit")))
        pg.reload()
        soon(merge_box(pg), ACT_MS).to_contain_text(removed_failed("unit"))
        gb_press(merge_box(pg).get_by_role("button", name="Add to merge queue"))
        soon(action(pg), ACT_MS).to_contain_text(queue_added(3))
        soon(merge_box(pg)).to_contain_text(queue_state(3))
        soon(merge_box(pg)).not_to_contain_text(removed_failed("unit"))
    assert change_json(w, "dev", n2)["state"] == "queued"


def test_wf_queue_timeout_reorder_reduced_keys(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    revs = {i: w.keys[f"e{i}"]["revision"] for i in (1, 2, 3)}
    n1, n2, n3 = (w.num(f"c{i}") for i in (1, 2, 3))
    with as_user(browser, w, "owner", reduced="reduce") as pg:
        pg.goto(w.url("/queue"))
        soon(qentry(pg, n3), ACT_MS).to_have_attribute("data-position", "3")
        watch(pg, "data-queue-entry-id")
        ready(qentry(pg, n3)).focus()
        for p in (2, 1):
            pg.keyboard.press("Alt+ArrowUp")
            soon(qentry(pg, n3), LIVE_MS).to_have_attribute("data-position", str(p))
            soon(qentry(pg, n3)).to_be_focused()
            soon(updates(pg), LIVE_MS).to_contain_text(ann_position(n3, p))
        soon(qentry(pg, n1)).to_have_attribute("data-position", "2")
        soon(qentry(pg, n2)).to_have_attribute("data-position", "3")
        soon(qentry(pg, n3)).to_have_attribute("data-anim", "none")
        assert "moving" not in anim_seen(pg)
        after = queue_data(w)
        assert all(entry_of(after, ids[i])["revision"] != revs[i] for i in (1, 2, 3))
        pg.reload()
        soon(qentry(pg, n3).get_by_role("button", name="Move up"), ACT_MS).to_be_disabled()
        soon(qentry(pg, n2).get_by_role("button", name="Move down")).to_be_disabled()
        soon(qentry(pg, n3)).to_contain_text(f"Queue revision {entry_of(after, ids[3])['revision']}")


def test_wf_queue_timeout_reorder_alt_down(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    ids = {i: w.keys[f"e{i}"]["id"] for i in (1, 2, 3)}
    revs = {i: w.keys[f"e{i}"]["revision"] for i in (1, 2, 3)}
    n1, n2 = w.num("c1"), w.num("c2")
    with as_user(browser, w, "owner") as cap, as_user(browser, w, "dev") as dev:
        for pg in (cap, dev):
            pg.goto(w.url("/queue"))
            soon(qentry(pg, n1), ACT_MS).to_have_attribute("data-position", "1")
        watch(cap, "data-queue-entry-id")
        ready(qentry(cap, n1)).focus()
        cap.keyboard.press("Alt+ArrowDown")
        soon(qentry(cap, n1), LIVE_MS).to_have_attribute("data-position", "2")
        soon(qentry(cap, n1)).to_be_focused()
        soon(qentry(cap, n1), ACT_MS).to_have_attribute("data-anim", "none")
        assert "moving" in anim_seen(cap)
        soon(qentry(dev, n2), LIVE_MS).to_have_attribute("data-position", "1")
        soon(qentry(dev, n1), LIVE_MS).to_have_attribute("data-position", "2")
        for n, p in ((n1, 2), (n2, 1)):
            soon(updates(dev), LIVE_MS).to_contain_text(ann_position(n, p))
    after = queue_data(w)
    assert all(entry_of(after, ids[i])["revision"] != revs[i] for i in (1, 2, 3))


def test_wf_queue_timeout_reorder_head_timeout(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c, n=2)
    e1, e2, r1, r2 = w.keys["e1"]["id"], w.keys["e2"]["id"], w.keys["e1"]["revision"], w.keys["e2"]["revision"]
    report(w, "dev", r1, "unit", "in_progress")
    report(w, "dev", r2, "unit", "success")
    timeout_at = iso(revision(w, "owner", r1)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS)
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        head, second = qentry(pg, w.num("c1")), qentry(pg, w.num("c2"))
        soon(gb_row(head, "unit"), ACT_MS).to_have_attribute("data-state", "in_progress")
        soon(gb_row(head, "unit")).to_contain_text("Times out at")
        advance_to(app_url, timeout_at + timedelta(seconds=3))
        eventually(lambda: entry_of(queue_data(w), e1)["reason"] == removed_timeout("unit"), "head entry removed with the timeout reason")
        new2 = entry_of(queue_data(w), e2)["revision"]
        assert new2 != r2
        pg.reload()
        soon(gb_history(pg, e1), ACT_MS).to_have_attribute("data-state", "removed")
        soon(gb_history(pg, e1)).to_contain_text(removed_timeout("unit"))
        soon(second).to_have_attribute("data-position", "1")
        soon(second).to_have_attribute("data-state", "waiting")
        soon(second).to_contain_text(f"Queue revision {new2}")
        soon(gb_row(second, "unit")).to_have_attribute("data-state", "queued")
        open_change(pg, w, w.num("c1"))
        soon(merge_box(pg)).to_contain_text(removed_timeout("unit"))


def test_wf_queue_timeout_reorder_draft_ready(browser, app_url):
    c = Cast("owner", "dev", "rev")
    steps = [S_push("dev", "base", "main", "Base", {"a.txt": "1\n"}), S_push("dev", "f1", "feat1", "E1", {"a.txt": "2\n"}, frm="main"),
             S_change("dev", "c1", "Draft", "feat1", draft=True), S_check("dev", "k1", "f1", "unit", "success")]
    w = make_world(app_url, c, steps, settings={"required_approvals": 0, "required_checks": ["unit"], "queue": True})
    err(w.api("dev", "POST", "/changes/1/queue"), 409, {"error": "A draft change cannot join the merge queue"})
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        soon(rule_items(pg)).to_have_text(["This change is a draft"])
        soon(gb_rule(pg, "draft")).to_have_count(1)
        queue_btn = merge_box(pg).get_by_role("button", name="Add to merge queue")
        soon(queue_btn).to_be_disabled()
        gb_press(merge_box(pg).get_by_role("button", name="Mark ready for review"))
        eventually(lambda: change_json(w, "dev", 1)["state"] == "open", "change #1 marked ready for review")
        threading.Event().wait(2 * LIVE_MS / 1000)
        pg.reload()
        soon(rule_items(pg), ACT_MS).to_have_text(["All merge rules are met"])
        gb_press(queue_btn)
        soon(action(pg), ACT_MS).to_contain_text(queue_added(1))
    assert change_json(w, "dev", 1)["state"] == "queued" and len(queue_data(w)["entries"]) == 1


GC_NOTE = "notes.txt"
GC_SAVED = re.compile(r"Saved as revision ([0-9a-f]{12})\.")


def gc_editor(pg, w, branch_name, path, text):
    pg.goto(w.url(f"/edit/{branch_name}/{path}"))
    soon(pg.get_by_role("textbox", name="File content"), ACT_MS).to_have_value(re.compile(re.escape(text)))


def gc_save(pg):
    ready(pg.get_by_role("button", name="Save file")).focus()
    pg.keyboard.press("Enter")


def gc_saved_id(pg):
    soon(action(pg), ACT_MS).to_contain_text(GC_SAVED)
    return GC_SAVED.search(action(pg).inner_text()).group(1)


def gc_outcome(pg, branch_name):
    found = GC_SAVED.search(action(pg).inner_text())
    if found:
        return found.group(1)
    strip = pg.get_by_role("alert", name="Announcement")
    return "stale" if strip.count() and stale_notice(branch_name) in strip.first.inner_text() else None


def test_wf_stale_head_edit_other_file(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "v0\n", PLAIN_PATH: "o0\n"})])
    typed, message = f"typed-{c.tag}\n", f"mine-{c.tag}"
    with as_user(browser, w, "dev") as pg:
        gc_editor(pg, w, "main", GC_NOTE, "v0")
        moved = push(w, "dev", "main", {PLAIN_PATH: f"o1-{c.tag}\n"}, "Other file")["revision"]
        fill(pg.get_by_role("textbox", name="File content"), typed)
        fill(pg.get_by_role("textbox", name="Revision message"), message)
        gc_save(pg)
        strip = pg.get_by_role("alert", name="Announcement")
        soon(strip, ACT_MS).to_contain_text(stale_notice("main"))
        soon(strip.get_by_role("button", name="Load latest")).to_be_visible()
        soon(pg.get_by_role("textbox", name="File content")).to_have_value(typed)
        soon(pg.get_by_role("textbox", name="Revision message")).to_have_value(message)
        soon(action(pg)).not_to_contain_text("Saved as revision")
    assert branch(w, "dev", "main") == moved
    assert raw_file(w, "dev", moved, GC_NOTE) == b"v0\n"


def test_wf_stale_head_edit_branch_resave(browser, app_url):
    c = Cast("owner", "dev", "rev")
    topic = f"topic-{c.tag}"
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "v0\n"}),
                                S_push("dev", "topic", topic, "Topic", {GC_NOTE: "t0\n"}, frm="main")])
    first_text, typed = f"first-{c.tag}\n", f"second-{c.tag} \t "
    with as_user(browser, w, "dev") as a, as_user(browser, w, "rev") as b:
        for pg in (a, b):
            gc_editor(pg, w, topic, GC_NOTE, "t0")
        fill(a.get_by_role("textbox", name="File content"), first_text)
        fill(a.get_by_role("textbox", name="Revision message"), f"a-{c.tag}")
        gc_save(a)
        first = gc_saved_id(a)
        fill(b.get_by_role("textbox", name="File content"), typed)
        fill(b.get_by_role("textbox", name="Revision message"), f"b-{c.tag}")
        gc_save(b)
        strip = b.get_by_role("alert", name="Announcement")
        soon(strip, ACT_MS).to_contain_text(stale_notice(topic))
        ready(strip.get_by_role("button", name="Load latest")).focus()
        b.keyboard.press("Enter")
        soon(b.get_by_role("region", name="Latest version"), ACT_MS).to_contain_text(first_text.strip())
        gc_save(b)
        second = gc_saved_id(b)
        b.goto(w.url(f"/blob/{topic}/{GC_NOTE}"))
        soon(b.get_by_role("region", name="File content"), ACT_MS).to_have_attribute("data-byte-length", str(len(typed.encode())))
    assert revision(w, "dev", second)["parents"] == [first] and branch(w, "dev", topic) == second
    assert raw_file(w, "dev", second, GC_NOTE) == typed.encode() and branch(w, "dev", "main") == w.keys["base"]["revision"]


def test_wf_stale_head_edit_retry_on_screen(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "v0\n"})])
    head = branch(w, "dev", "main")
    typed, message = f"once-{c.tag}", f"once-msg-{c.tag}"
    with as_user(browser, w, "dev") as pg:
        gc_editor(pg, w, "main", GC_NOTE, "v0")
        fill(pg.get_by_role("textbox", name="File content"), typed)
        fill(pg.get_by_role("textbox", name="Revision message"), message)
        gc_save(pg)
        saved = gc_saved_id(pg)
        retry = {"branch": "main", "expected_head": head, "message": message, "files": [{"path": GC_NOTE, "content": typed}]}
        err(w.api("dev", "POST", "/push", retry), 409, {"error": "Stale head", "current_head": saved})
        twin = revision_id([saved], message, {GC_NOTE: typed.encode()})
        pg.goto(w.url())
        recent = pg.get_by_role("list", name="Recent revisions")
        soon(recent.get_by_role("link", name=saved, exact=True), ACT_MS).to_have_count(1)
        soon(recent.get_by_role("link", name=twin, exact=True)).to_have_count(0)
        pg.goto(w.url(f"/blob/main/{GC_NOTE}"))
        soon(pg.get_by_role("region", name="File content"), ACT_MS).to_have_attribute("data-byte-length", str(len(typed.encode())))
    assert branch(w, "dev", "main") == saved and revision(w, "dev", saved)["parents"] == [head]


def test_wf_stale_head_edit_simultaneous(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "v0\n"})])
    head = branch(w, "dev", "main")
    with as_user(browser, w, "dev") as a, as_user(browser, w, "rev") as b:
        pages = {"a": a, "b": b}
        for k, pg in pages.items():
            gc_editor(pg, w, "main", GC_NOTE, "v0")
            fill(pg.get_by_role("textbox", name="File content"), f"{k}-{c.tag}")
            fill(pg.get_by_role("textbox", name="Revision message"), f"{k}-msg-{c.tag}")
            ready(pg.get_by_role("button", name="Save file")).focus()
        for pg in pages.values():
            pg.keyboard.press("Enter")
        got = {k: eventually(lambda pg=pg: gc_outcome(pg, "main"), f"save outcome in editor {k}") for k, pg in pages.items()}
        won = [k for k, v in got.items() if v != "stale"]
        assert len(won) == 1, got
        lost = next(k for k in pages if k not in won)
        soon(pages[lost].get_by_role("textbox", name="File content")).to_have_value(f"{lost}-{c.tag}")
    winner = got[won[0]]
    assert branch(w, "dev", "main") == winner and revision(w, "dev", winner)["parents"] == [head]
    assert raw_file(w, "dev", winner, GC_NOTE) == f"{won[0]}-{c.tag}".encode()


def test_wf_stale_head_edit_after_suggestion(browser, app_url):
    c = Cast("owner", "dev", "rev", "pair")
    body = f"wording-{c.tag}"
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "one\ntwo\n"}),
                                S_push("dev", "feat", "feat", "Edit", {GC_NOTE: "one\nTWO\n"}, frm="main"),
                                S_change("dev", "c1", "Suggest", "feat"), S_thread("rev", "t1", "c1", GC_NOTE, 2, body, ["Two"])])
    typed = f"pair-{c.tag}\n"
    with as_user(browser, w, "pair") as pair, as_user(browser, w, "dev") as author:
        gc_editor(pair, w, "feat", GC_NOTE, "TWO")
        open_change(author, w)
        art = author.locator("[data-thread-id]").filter(has_text=body)
        ready(art.get_by_role("region", name="Suggested change").get_by_role("button", name="Apply suggestion")).focus()
        author.keyboard.press("Enter")
        soon(action(author), ACT_MS).to_contain_text("Suggestions applied in revision ")
        fill(pair.get_by_role("textbox", name="File content"), typed)
        fill(pair.get_by_role("textbox", name="Revision message"), f"pair-msg-{c.tag}")
        gc_save(pair)
        strip = pair.get_by_role("alert", name="Announcement")
        soon(strip, ACT_MS).to_contain_text(stale_notice("feat"))
        ready(strip.get_by_role("button", name="Load latest")).focus()
        pair.keyboard.press("Enter")
        soon(pair.get_by_role("region", name="Latest version"), ACT_MS).to_contain_text("Two")
        soon(pair.get_by_role("textbox", name="File content")).to_have_value(typed)
    applied = change_json(w, "dev", 1)["head_revision"]
    assert branch(w, "dev", "feat") == applied and revision(w, "dev", applied)["message"] == msg_apply(1)


def test_wf_phone_review_removed_row(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "l1\nl2\nl3\nl4\n"}),
                                S_push("dev", "feat", "feat", "Edit", {GC_NOTE: "n1\nn2\nl1\nl2\nl4\n"}, frm="main"),
                                S_change("dev", "c1", "Phone", "feat")])
    body = f"old-side-{c.tag}"
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        soon(pg.get_by_role("radiogroup", name="Diff view")).to_have_count(0)
        tap(row(pg, GC_NOTE, removed(3, "l3")))
        cursor = pg.locator('[role="row"][data-cursor="true"]')
        soon(cursor).to_have_attribute("data-kind", "removed")
        soon(cursor).to_have_attribute("data-old-line", "3")
        tap(pg.get_by_role("button", name=comment_button(3)))
        dlg = pg.get_by_role("dialog", name=comment_dialog(GC_NOTE, 3))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_visible()
        for role, name in (("checkbox", "Add a suggestion"), ("textbox", "Suggested lines"), ("spinbutton", "Through line")):
            soon(dlg.get_by_role(role, name=name)).to_have_count(0)
        fill(dlg.get_by_role("textbox", name="Comment", exact=True), body)
        tap(dlg.get_by_role("button", name="Add comment"))
        soon(action(pg), ACT_MS).to_contain_text("Comment added.")
        art = pg.locator("[data-thread-id]").filter(has_text=body)
        soon(art, ACT_MS).to_have_attribute("data-side", "old")
        soon(art).to_have_attribute("data-line", "3")
        soon(art).to_have_attribute("data-path", GC_NOTE)
        layout(pg)


def test_wf_phone_review_touch_to_met(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        soon(rule_items(pg).filter(has_text=rule_approvals(1, 0))).to_have_count(1)
        tap(pg.get_by_role("button", name="Review changes"))
        dlg = pg.get_by_role("dialog", name="Submit review")
        turn_on(dlg.get_by_role("radio", name="Approve"), touch=True)
        tap(dlg.get_by_role("button", name="Submit review"))
        soon(action(pg), ACT_MS).to_contain_text("Review submitted.")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("rev"), "approved"))
        soon(rule_items(pg).filter(has_text=rule_approvals(1, 0)), LIVE_MS).to_have_count(0)
        report(w, "dev", head, "lint", "success")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_check(1, "lint", "success"))
        soon(rule_items(pg).first, LIVE_MS).to_have_attribute("data-rule", "met")
        soon(rule_items(pg).first).to_have_text("All merge rules are met")
        btn = merge_box(pg).get_by_role("button", name="Merge change")
        soon(btn).to_be_enabled()
        box = btn.bounding_box()
        assert box["width"] >= TAP_MIN_PX and box["height"] >= TAP_MIN_PX, box
        layout(pg)


def test_wf_screen_reader_review_push_announced(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "keep\nold\n"}),
                                S_push("dev", "feat", "feat", "Edit", {GC_NOTE: "keep\nmid\n"}, frm="main"),
                                S_change("dev", "c1", "Spoken", "feat"), S_review("rev", "r1", "c1", "approve")])
    with as_user(browser, w, "rev") as rev, as_user(browser, w, "dev") as dev:
        open_change(rev, w)
        gc_editor(dev, w, "feat", GC_NOTE, "mid")
        fill(dev.get_by_role("textbox", name="File content"), "keep\n\nnew\n")
        fill(dev.get_by_role("textbox", name="Revision message"), f"spoken-{c.tag}")
        gc_save(dev)
        rid = gc_saved_id(dev)
        soon(updates(rev), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        open_change(rev, w)
        soon(row(rev, GC_NOTE, "@@ -1,2 +1,3 @@")).to_have_count(1)
        rev.keyboard.press("j")
        for i, name in enumerate([unchanged(1, "keep"), removed(2, "old"), added(2, "(empty line)"), added(3, "new")]):
            if i:
                rev.keyboard.press("ArrowDown")
            soon(row(rev, GC_NOTE, name)).to_be_focused()
            soon(row(rev, GC_NOTE, name)).to_have_attribute("data-cursor", "true")


def test_wf_screen_reader_review_shortcut_dialog(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown"):
            pg.keyboard.press(key)
        cursor = row(pg, "a.txt", removed(2, "l2"))
        soon(cursor).to_be_focused()
        dlg = pg.get_by_role("dialog", name="Submit review")
        pg.keyboard.press("r")
        soon(dlg.get_by_role("radio").first).to_be_focused()
        trap(pg, dlg)
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_be_focused()
        pg.keyboard.press("r")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"fine-{c.tag}")
        pg.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("rev"), "approved"))
        report(w, "dev", head, "lint", "success")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_check(1, "lint", "success"))
        soon(cursor).to_have_attribute("data-cursor", "true")


def test_wf_roles_boundaries_reader_keyboard(browser, app_url):
    c = Cast("owner", "dev", "rdr")
    w = diff_world(app_url, c, roles={"rdr": "reader"})
    reason = "Readers cannot approve or request changes"
    body = f"reader-{c.tag}"
    with as_user(browser, w, "rdr") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown", "c"):
            pg.keyboard.press(key)
        fill(pg.get_by_role("dialog", name=comment_dialog("a.txt", 2)).get_by_role("textbox", name="Comment", exact=True), body)
        pg.keyboard.press("Control+Enter")
        soon(action(pg), ACT_MS).to_contain_text("Comment added.")
        soon(pg.locator("[data-thread-id]").filter(has_text=body)).to_have_count(1)
        soon(updates(pg), LIVE_MS).to_contain_text(ann_comment(1, c.name("rdr")))
        pg.keyboard.press("r")
        dlg = pg.get_by_role("dialog", name="Submit review")
        for name in ("Approve", "Request changes"):
            soon(dlg.get_by_role("radio", name=name)).to_be_disabled()
        soon(dlg.get_by_text(reason).first).to_be_visible()
        turn_on(dlg.get_by_role("radio", name="Comment"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"note-{c.tag}")
        pg.keyboard.press("Control+Enter")
        soon(action(pg), ACT_MS).to_contain_text("Review submitted.")
        soon(pg.get_by_role("list", name="Reviews").get_by_role("listitem").first, ACT_MS).to_have_attribute("data-state", "commented")
    err(review_api(w, "rdr", 1, "approve"), 403, {"error": reason})
    assert change_json(w, "dev", 1)["counts"]["approvals_remaining"] == 1


def test_wf_roles_boundaries_dismiss_keyboard(browser, app_url):
    c = Cast("owner", "dev", "mnt", "rev")
    w = diff_world(app_url, c, settings={"required_approvals": 0, "required_checks": []}, extra=[S_review("rev", "rc", "c1", "request_changes", "Fix it")],
                   roles={"mnt": "maintainer"})
    reason = f"handled-{c.tag}"
    with as_user(browser, w, "dev") as author, as_user(browser, w, "mnt") as mnt:
        for pg in (author, mnt):
            open_change(pg, w)
        soon(rule_items(author).filter(has_text=rule_changes(c.name("rev")))).to_have_count(1)
        soon(author.get_by_role("button", name="Dismiss review")).to_have_count(0)
        ready(mnt.get_by_role("button", name="Dismiss review")).focus()
        mnt.keyboard.press("Enter")
        dlg = mnt.get_by_role("dialog", name="Dismiss review")
        fill(dlg.get_by_role("textbox", name="Reason"), reason)
        ready(dlg.get_by_role("button", name="Confirm dismissal")).focus()
        mnt.keyboard.press("Enter")
        soon(action(mnt), ACT_MS).to_contain_text("Review dismissed.")
        item = author.get_by_role("list", name="Reviews").get_by_role("listitem").first
        soon(item, LIVE_MS).to_have_attribute("data-state", "dismissed")
        soon(item).to_contain_text(dismissed_by(c.name("mnt"), reason))
        soon(rule_items(author).first, LIVE_MS).to_have_attribute("data-rule", "met")
        soon(merge_box(author).get_by_role("button", name="Merge change")).to_be_enabled()
        soon(updates(author), LIVE_MS).to_contain_text(ann_dismissed(1, c.name("rev")))
        soon(updates(mnt), LIVE_MS).to_contain_text(ann_dismissed(1, c.name("rev")))
    assert change_json(w, "dev", 1)["changes_requested"] is False


def test_wf_mail_and_archive_ui_mails(browser, app_url, mail):
    c = Cast("owner", "dev", "rev", "ment")
    w = diff_world(app_url, c)
    title = change_json(w, "dev", 1)["title"]
    cid, link = f"{c.org}/{c.repo}#1", f"/{c.org}/{c.repo}/changes/1"
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown", "c"):
            pg.keyboard.press(key)
        box = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2)).get_by_role("textbox", name="Comment", exact=True)
        fill(box, f"@{c.n('ment')} @{c.n('ment')} look-{c.tag}")
        pg.keyboard.press("Control+Enter")
        soon(action(pg), ACT_MS).to_contain_text("Comment added.")
        fill(pg.get_by_role("textbox", name="Reviewer username"), c.n("rev"))
        ready(pg.get_by_role("button", name="Request review")).focus()
        pg.keyboard.press("Enter")
        soon(action(pg), ACT_MS).to_contain_text(f"Review requested from {c.name('rev')}.")
    mention = subj_mention(c, 1, c.name("dev"))
    assert_change_mail(mail, wait_mails(mail, c.people["ment"]["email"], mention)[0], cid, link)
    assert_change_mail(mail, wait_mails(mail, c.people["rev"]["email"], subj_review(c, 1, title))[0], cid, link)
    got = [m for m in mail.messages() if c.people["ment"]["email"] in addresses(m.get("To")) and m.get("Subject") == mention]
    assert len(got) == 1, [m.get("Subject") for m in got]


def test_wf_mail_and_archive_merge_export(browser, app_url):
    c = Cast("owner", "dev")
    title = f"Ship-{c.tag}"
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"a.txt": "1\n", NESTED_PATH: "n\n"}),
                                S_push("dev", "feat", "feat", "Edit", {"a.txt": "2\n", GC_NOTE: "add\n"}, frm="main"),
                                S_change("dev", "c1", title, "feat")], settings={"required_approvals": 0})
    base, head = branch(w, "owner", "main"), change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "owner") as pg:
        open_change(pg, w)
        merge = merge_box(pg).get_by_role("button", name="Merge change")
        soon(merge).to_be_enabled()
        ready(merge).focus()
        pg.keyboard.press("Enter")
        soon(action(pg), ACT_MS).to_contain_text("Change #1 merged.")
        rid = branch(w, "owner", "main")
        soon(merge_box(pg), LIVE_MS).to_contain_text(merged_into("main", rid))
        pg.goto(w.url(f"/revisions/{rid}"))
        btn = pg.get_by_role("button", name="Export archive")
        soon(btn, ACT_MS).to_be_visible()
        ready(btn).focus()
        pg.keyboard.press("Enter")
        key = f"archives/{w.repo_id}/{rid}.zip"
        soon(action(pg), ACT_MS).to_contain_text(f"Archive saved to {key}")
    z = zipfile.ZipFile(io.BytesIO(S3().get(key)))
    prefix = f"{c.repo}-{rid}/"
    want = [prefix + p for p in ("a.txt", GC_NOTE, NESTED_PATH, "REVISION.txt")]
    assert sorted((n for n in z.namelist() if not n.endswith("/")), key=bkey) == sorted(want, key=bkey)
    assert z.read(prefix + "a.txt") == b"2\n" and z.read(prefix + GC_NOTE) == b"add\n" and z.read(prefix + NESTED_PATH) == b"n\n"
    lines = z.read(prefix + "REVISION.txt").decode().split("\n")
    assert lines[:4] == [f"revision: {rid}", f"parents: {base}, {head}", f"author: {c.n('owner')}", f"message: {msg_merge(1, title)}"]
    assert lines[5] == "files: 3"


def test_wf_mail_and_archive_outage_keyboard(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: "note\n"})])
    rid = branch(w, "dev", "main")
    down = os.environ.get("APP_MINIO_DOWN_URL")
    assert down, "APP_MINIO_DOWN_URL must name the storage outage instance"
    typed, message = f"offline-{c.tag}", f"offline-msg-{c.tag}"
    dusers = down_login(down, c, "owner")
    with as_user(browser, w, "owner", base=down, users=dusers) as pg:
        strip = pg.get_by_role("alert", name="Announcement")
        pg.goto(f"{down}{w.path(f'/revisions/{rid}')}")
        btn = pg.get_by_role("button", name="Export archive")
        soon(btn, ACT_MS).to_be_visible()
        ready(btn).focus()
        pg.keyboard.press("Enter")
        soon(strip, ACT_MS).to_contain_text(OUTAGE_EXPORT)
        pg.goto(f"{down}{w.path(f'/edit/main/{GC_NOTE}')}")
        box = pg.get_by_role("textbox", name="File content")
        soon(box, ACT_MS).to_have_value("")
        fill(box, typed)
        fill(pg.get_by_role("textbox", name="Revision message"), message)
        ready(pg.get_by_role("button", name="Save file")).focus()
        pg.keyboard.press("Enter")
        soon(strip, ACT_MS).to_contain_text(OUTAGE_PUSH)
        soon(box).to_have_value(typed)
        soon(pg.get_by_role("textbox", name="Revision message")).to_have_value(message)
    assert branch(w, "dev", "main") == rid and not S3().keys(f"archives/{w.repo_id}/")


GD_SAME_A = "2\n"


def gd_review(pg, review_id):
    return pg.get_by_role("list", name="Reviews").locator(f'[data-review-id="{review_id}"]')


def gd_rule_item(pg, rule):
    return pg.locator(f'[data-rule="{rule}"]')


def gd_rail_result(pg, n, result):
    return pg.locator(f'[data-change-number="{n}"][data-restack="{result}"]')


def test_wf_push_dismisses_twice_approved(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = approval_world(app_url, c, [S_review("rev", "r2", "c1", "approve")])
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        merge = merge_box(pg).get_by_role("button", name="Merge change")
        latest = gd_review(pg, w.keys["r2"]["id"])
        soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        soon(latest).to_have_attribute("data-state", "approved")
        soon(merge).to_be_enabled()
        rid = push(w, "dev", "feat", {"a.txt": f"{c.tag}\n"})["revision"]
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        soon(latest).to_have_attribute("data-state", "dismissed")
        soon(latest).to_contain_text("Dismissed: the change was updated after this approval")
        soon(rule_items(pg)).to_have_text([rule_approvals(1, 0)])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "approvals")
        soon(pg.get_by_text("Approvals remaining: 1")).to_be_visible()
        soon(pg.locator("[data-approvals-remaining]").first).to_have_attribute("data-approvals-remaining", "1")
        soon(merge).to_be_disabled()
    assert change_json(w, "dev", 1)["counts"]["approvals_remaining"] == 1


def test_wf_push_dismisses_request_not_revived(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = approval_world(app_url, c, [S_review("rev", "rc", "c1", "request_changes", f"fix-{c.tag}")])
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        open_change(author, w)
        open_change(rev, w)
        soon(rule_items(author)).to_have_text([rule_approvals(1, 0), rule_changes(c.name("rev"))])
        rev.keyboard.press("r")
        dlg = rev.get_by_role("dialog", name="Submit review")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"fixed-{c.tag}")
        rev.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(rule_items(author), LIVE_MS).to_have_text(["All merge rules are met"])
        rid = push(w, "dev", "feat", {"a.txt": f"{c.tag}\n"})["revision"]
        soon(updates(author), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        soon(rule_items(author)).to_have_text([rule_approvals(1, 0)])
        soon(gb_rule(author, "changes-requested")).to_have_count(0)
        soon(merge_box(author).get_by_role("button", name="Merge change")).to_be_disabled()
    assert change_json(w, "dev", 1)["changes_requested"] is False


def test_wf_code_owners_twice_approved_push(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n", {GA_MAIN: f"main-{c.tag}\n"}, team=())
    for _ in range(2):
        ok(review_api(w, "mira", 1, "approve"), 201)
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        merge = merge_box(pg).get_by_role("button", name="Merge change")
        soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        soon(merge).to_be_enabled()
        rid = push(w, "dev", "feat", {GA_MAIN: f"moved-{c.tag}\n"})["revision"]
        soon(updates(pg), LIVE_MS).to_contain_text(ann_new_rev(1, rid, c.name("dev"), False))
        soon(rule_items(pg)).to_have_text([rule_owners([GA_MAIN])])
        soon(rule_items(pg).first).to_have_attribute("data-rule", "code-owners")
        soon(merge).to_be_disabled()
    assert rules_of(w, "dev", 1)["code-owners"] == rule_owners([GA_MAIN])


def test_wf_code_owners_dialog_open_live(browser, app_url):
    c = owners_cast()
    w = owners_world(app_url, c, f"* @{c.n('mira')}\n/src/ @{c.org}/{c.team}\n", {GA_MAIN: f"main-{c.tag}\n", GA_SRC[0]: f"src-{c.tag}\n"})
    with as_user(browser, w, "dev") as author, as_user(browser, w, "mira") as mira:
        open_change(author, w)
        open_change(mira, w)
        soon(rule_items(mira)).to_have_text([rule_owners([GA_MAIN, GA_SRC[0]])])
        opener = mira.get_by_role("button", name="Review changes", exact=True)
        ga_press(opener)
        dlg = mira.get_by_role("dialog", name="Submit review")
        soon(dlg).to_be_visible()
        ok(review_api(w, "tomas", 1, "approve"), 201)
        soon(rule_items(author), LIVE_MS).to_have_text([rule_owners([GA_MAIN])])
        soon(gd_rule_item(mira, "code-owners"), LIVE_MS).to_have_text(rule_owners([GA_MAIN]))
        soon(dlg).to_be_visible()
        mira.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(opener).to_be_focused()
        mira.keyboard.press("Enter")
        turn_on(dlg.get_by_role("radio", name="Approve"))
        fill(dlg.get_by_role("textbox", name="Review summary"), f"owner-{c.tag}")
        mira.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(rule_items(author), LIVE_MS).to_have_text(["All merge rules are met"])
        soon(merge_box(author).get_by_role("button", name="Merge change")).to_be_enabled()


def test_wf_restack_keeps_approval_twice_approved(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, [S_review("rev", "r2", "c2", "approve"), S_review("rev", "r2b", "c2", "approve")])
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, 2)
        merge = merge_box(pg).get_by_role("button", name="Merge change")
        soon(rule_items(pg)).to_have_text(["All merge rules are met"])
        soon(merge).to_be_enabled()
        push(w, "dev", GA_LOW, {"a.txt": GD_SAME_A})
        soon(stack_row(pg, 2), ACT_MS).to_have_attribute("data-restack", "dismissed")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_restack(2, 1, False))
        count = change_json(w, "dev", 2)["restack"]["dismissed_count"]
        soon(stack_row(pg, 2)).to_contain_text(word_dismissed(count))
        soon(gd_review(pg, w.keys["r2b"]["id"])).to_have_attribute("data-state", "dismissed")
        soon(rule_items(pg)).to_have_text([rule_approvals(1, 0)])
        soon(pg.get_by_text("Approvals remaining: 1")).to_be_visible()
        soon(merge).to_be_disabled()
    assert count >= 1 and "approvals" in rules_of(w, "dev", 2)


def test_wf_restack_keeps_approval_comment_open_restack(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, [S_review("rev", "r3", "c3", "approve"), {"as": "rev", "key": "v3", "viewed": {"change": "c3", "path": "c.txt"}}])
    with as_user(browser, w, "rev", reduced="reduce") as pg:
        open_change(pg, w, 3)
        pg.keyboard.press("j")
        cursor = row(pg, "c.txt", removed(1, "1"))
        soon(cursor).to_be_focused()
        pg.keyboard.press("c")
        dlg = pg.get_by_role("dialog", name=comment_dialog("c.txt", 1))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_focused()
        pg.keyboard.type(f"draft-{c.tag}")
        push(w, "dev", GA_LOW, {"b.txt": f"{c.tag}\n"})
        soon(gd_rail_result(pg, 3, "kept"), ACT_MS).to_have_count(1)
        soon(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(updates(pg)).to_contain_text(ann_restack(3, 2, True))
        soon(stack_row(pg, 3)).to_contain_text("Approvals kept")
        soon(pg.get_by_role("checkbox", name="Viewed")).to_be_checked()
        soon(gd_review(pg, w.keys["r3"]["id"])).to_have_attribute("data-state", "approved")
        soon(cursor).to_have_attribute("data-cursor", "true")
        soon(cursor).to_be_focused()


GE_SHOWN = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+)")
GE_QREV = re.compile(r"Queue revision ([0-9a-f]{12})")


def ge_assert_shown(text, moment):
    m = GE_SHOWN.search(text)
    assert m, f"no displayed time in {text!r}"
    local = moment.astimezone(WORKSPACE_TZ)
    shown = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
    assert abs(shown - local.replace(tzinfo=None)) <= timedelta(seconds=1), f"shown {m.group(1)}, expected {local:%Y-%m-%d %H:%M:%S}"
    assert m.group(2) == local.tzname(), f"zone shown as {m.group(2)!r}, expected the workspace zone abbreviation {local.tzname()!r}"


def test_wf_check_lifecycle_zone_abbreviation(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    due = iso(revision(w, "dev", head)["created_at"]) + timedelta(seconds=CHECK_TIMEOUT_SECONDS)
    with as_user(browser, w, "rev") as pg:
        pg.clock.set_fixed_time(FAR_FUTURE)
        open_change(pg, w)
        lint = check_item(pg, "lint")
        soon(lint, ACT_MS).to_have_attribute("data-state", "queued")
        report(w, "dev", head, "lint", "in_progress")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_check(1, "lint", "in_progress"))
        soon(lint, LIVE_MS).to_have_attribute("data-state", "in_progress")
        soon(lint).to_contain_text(WORD["in_progress"])
        soon(lint).to_contain_text(re.compile(r"Times out at " + GE_SHOWN.pattern))
        ge_assert_shown(lint.inner_text().split("Times out at", 1)[1], due)


def test_wf_check_lifecycle_live_dialog_escape(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = check_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown"):
            pg.keyboard.press(key)
        cursor = row(pg, "a.txt", added(2, "L2"))
        soon(cursor).to_be_focused()
        pg.keyboard.press("c")
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_focused()
        report(w, "dev", head, "lint", "success")
        soon(gb_row(pg, "lint").first, LIVE_MS).to_have_attribute("data-state", "success")
        soon(dlg).to_be_visible()
        assert inside(dlg), "focus left the open comment dialog when the live update landed"
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_have_attribute("data-cursor", "true")
        soon(cursor).to_be_focused()
        soon(updates(pg)).to_contain_text(ann_check(1, "lint", "success"))
        soon(check_item(pg, "lint")).to_contain_text(WORD["success"])


def test_wf_queue_middle_fails_requeue_revision(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c, n=1)
    n, old = w.num("c1"), w.keys["e1"]["revision"]
    report(w, "dev", old, "unit", "failure")
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w, n)
        soon(merge_box(pg), ACT_MS).to_contain_text(removed_failed("unit"))
        gb_press(merge_box(pg).get_by_role("button", name="Add to merge queue"))
        soon(action(pg), ACT_MS).to_contain_text(queue_added(1))
        soon(merge_box(pg)).to_contain_text(queue_state(1))
        pg.goto(w.url("/queue"))
        entry = qentry(pg, n)
        soon(entry, ACT_MS).to_contain_text(GE_QREV)
        qrev = GE_QREV.search(entry.inner_text()).group(1)
        message = revision(w, "dev", qrev)["message"]
        assert message == msg_queue(n, 2), f"re-queued entry runs on {qrev} ({message!r}), expected a new {msg_queue(n, 2)!r}"
        unit = gb_row(entry, "unit")
        soon(unit).to_have_attribute("data-state", "queued")
        soon(unit).to_contain_text(WORD["queued"])
        soon(unit).to_contain_text("Times out at")
        soon(entry).to_have_attribute("data-state", "waiting")


def test_wf_queue_middle_fails_entry_summary(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = queue_world(app_url, c)
    note = f"runner-{c.tag}"
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        mid = qentry(pg, w.num("c2"))
        unit = gb_row(mid, "unit")
        soon(unit, ACT_MS).to_have_attribute("data-state", "queued")
        report(w, "dev", w.keys["e2"]["revision"], "unit", "in_progress", note)
        soon(mid, LIVE_MS).to_have_attribute("data-state", "checking")
        soon(unit, LIVE_MS).to_have_attribute("data-state", "in_progress")
        soon(unit).to_contain_text(WORD["in_progress"])
        soon(unit).to_contain_text("Times out at")
        for key in ("c1", "c3"):
            soon(qentry(pg, w.num(key))).to_have_attribute("data-state", "waiting")
            soon(gb_row(qentry(pg, w.num(key)), "unit")).to_have_attribute("data-state", "queued")
        soon(unit).to_contain_text(note)


def test_wf_stack_merge_retarget_merged_announced(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = stack_world(app_url, c, settings={"required_approvals": 0})
    with as_user(browser, w, "dev") as author, as_user(browser, w, "rev") as rev:
        open_change(author, w, 1)
        open_change(rev, w, 2)
        gb_press(merge_box(author).get_by_role("button", name="Merge change"))
        soon(action(author), ACT_MS).to_contain_text("Change #1 merged.")
        soon(gb_notice(rev), LIVE_MS).to_have_attribute("data-notice", "base-changed")
        soon(gb_notice(rev)).to_contain_text(notice_base("main", 1))
        soon(updates(rev), LIVE_MS).to_contain_text(ann_restack(2, 1, True))
        soon(updates(rev), LIVE_MS).to_contain_text(ann_merged(1))
    assert change_json(w, "dev", 2)["base"] == "main"


def test_wf_stack_merge_retarget_history_zone(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = gb_pair_world(app_url, c, queued=True)
    eid, qrev = w.keys["e1"]["id"], w.keys["e1"]["revision"]
    with as_user(browser, w, "owner") as pg:
        pg.goto(w.url("/queue"))
        entry = qentry(pg, 1)
        soon(entry, ACT_MS).to_have_attribute("data-state", "waiting")
        report(w, "dev", qrev, "unit", "success")
        soon(entry, LIVE_MS).to_have_attribute("data-state", "checking")
        clock(app_url, QUEUE_STEP_SECONDS)
        eventually(lambda: change_json(w, "dev", 1)["state"] == "merged", "change #1 merged by the queue step")
        pg.reload()
        done = gb_history(pg, eid)
        soon(done, ACT_MS).to_have_attribute("data-state", "merged")
        when = done.locator("time").first
        soon(when).to_contain_text(GE_SHOWN)
        ge_assert_shown(when.inner_text(), iso(attr(when, "datetime")))


GF_CRLF = "\nfirst \r\nsecond\t\r\n"
GF_LEAD = "\nlead line \nbody\t\n"
GF_DRAWER = ("drawer/first-entry.txt", "drawer/second-entry.txt")
GF_HIT_JS = """(e) => {
  e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  const size = el => { const b = el.getBoundingClientRect(); return [b.width, b.height]; };
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label ? [size(e), size(label)] : [size(e)];
}"""


def gf_small_targets(controls):
    bad = []
    for name, control in controls:
        soon(control).to_have_count(1)
        sizes = control.evaluate(GF_HIT_JS)
        if not any(w >= TAP_MIN_PX and h >= TAP_MIN_PX for w, h in sizes):
            bad.append((name, sizes))
    return bad


def gf_live_check(pg, w, name="lint"):
    report(w, "dev", change_json(w, "dev", 1)["head_revision"], name, "success")
    soon(pg.locator(f'[data-check-name="{name}"]').first, LIVE_MS).to_have_attribute("data-state", "success")


def test_wf_stale_head_edit_exact_text_views(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {"seed.txt": f"seed-{c.tag}\n"})])
    base = w.keys["base"]["revision"]
    rid = push(w, "dev", "main", {"seed.txt": None, CRLF_PATH: GF_CRLF}, f"crlf-{c.tag}")["revision"]
    assert revision(w, "dev", rid)["parents"] == [base]
    assert w.api("dev", "GET", "/branches/main").json()["revision"] == rid
    with as_user(browser, w, "dev") as pg:
        for tail in (f"/blob/main/{CRLF_PATH}", f"/revisions/{rid}"):
            pg.goto(w.url(tail))
            region = pg.get_by_role("region", name="File content")
            soon(region, ACT_MS).to_have_attribute("data-byte-length", str(len(GF_CRLF.encode())))
            soon(region, ACT_MS).to_have_js_property("textContent", GF_CRLF)


def test_wf_stale_head_edit_unedited_save_bytes(browser, app_url):
    c = Cast("owner", "dev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GC_NOTE: GF_LEAD})])
    head = branch(w, "dev", "main")
    with as_user(browser, w, "dev") as pg:
        gc_editor(pg, w, "main", GC_NOTE, GF_LEAD.split("\n")[1])
        fill(pg.get_by_role("textbox", name="Revision message"), f"unedited-{c.tag}")
        gc_save(pg)
        saved = gc_saved_id(pg)
    assert branch(w, "dev", "main") == saved and revision(w, "dev", saved)["parents"] == [head]
    assert raw_file(w, "dev", saved, GC_NOTE) == GF_LEAD.encode()


def test_wf_phone_review_drawer_radio_targets(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = make_world(app_url, c, [S_push("dev", "base", "main", "Base", {GF_DRAWER[0]: "l1\nl2\nl3\n"}),
                                S_push("dev", "feat", "feat", "Edit", {GF_DRAWER[0]: "l1\nL2\nl3\n", GF_DRAWER[1]: "x\ny"}, frm="main"),
                                S_change("dev", "c1", "Drawer", "feat")])
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        tap(pg.get_by_role("button", name="Files"))
        dlg = pg.get_by_role("dialog", name="Files")
        soon(dlg).to_be_visible()
        bad = gf_small_targets([(p, dlg.get_by_role("link", name=p, exact=True)) for p in GF_DRAWER])
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        tap(pg.get_by_role("button", name="Review changes"))
        rd = pg.get_by_role("dialog", name="Submit review")
        soon(rd).to_be_visible()
        bad += gf_small_targets([(n, rd.get_by_role("radio", name=n, exact=True)) for n in ("Comment", "Approve", "Request changes")])
    assert bad == [], bad


def test_wf_phone_review_files_focus_after_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        files = pg.get_by_role("button", name="Files")
        tap(files)
        dlg = pg.get_by_role("dialog", name="Files")
        soon(dlg.get_by_role("link", name="a.txt")).to_be_visible()
        gf_live_check(pg, w)
        soon(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(files).to_be_focused()


def test_wf_phone_review_comment_button_after_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev", size=PHONE) as pg:
        open_change(pg, w)
        tap(row(pg, "a.txt", added(2, "L2")))
        btn = pg.get_by_role("button", name=comment_button(2))
        soon(btn).to_be_visible()
        gf_live_check(pg, w)
        cursor = pg.locator('[role="row"][data-cursor="true"]')
        soon(cursor).to_have_attribute("data-path", "a.txt")
        soon(cursor).to_have_attribute("data-new-line", "2")
        soon(btn).to_be_visible()
        tap(btn)
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        soon(dlg.get_by_role("textbox", name="Comment", exact=True)).to_be_visible()


GG_SHOWN_TIME = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+)")


def gg_shown_times(scope):
    stamps, out = scope.locator("time"), []
    for i in range(stamps.count()):
        stamp = stamps.nth(i)
        when = iso(stamp.get_attribute("datetime")).astimezone(WORKSPACE_TZ)
        shown = GG_SHOWN_TIME.search(stamp.inner_text())
        out.append((when, shown.group(1) if shown else None, shown.group(2) if shown else None))
    return out


def test_wf_screen_reader_review_live_escape_opener(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    head = change_json(w, "dev", 1)["head_revision"]
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        opener = pg.get_by_role("button", name="Review changes", exact=True)
        click(opener)
        dlg = pg.get_by_role("dialog", name="Submit review")
        soon(dlg).to_be_visible()
        fill(dlg.get_by_role("textbox", name="Review summary"), f"draft-{c.tag}")
        report(w, "dev", head, "lint", "success")
        soon(gb_row(pg, "lint").first, LIVE_MS).to_have_attribute("data-state", "success")
        soon(dlg).to_be_visible()
        assert inside(dlg), "focus left the open review dialog when the update arrived"
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(opener).to_be_focused()
        soon(updates(pg)).to_contain_text(ann_check(1, "lint", "success"))


def test_wf_screen_reader_review_link_shortcut_return(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        pg.keyboard.press("j")
        cursor = row(pg, "a.txt", unchanged(1, "l1"))
        soon(cursor).to_be_focused()
        link = pg.get_by_role("navigation", name="File tree").get_by_role("link", name="b.txt", exact=True)
        ready(link).focus()
        soon(link).to_be_focused()
        pg.keyboard.press("r")
        dlg = pg.get_by_role("dialog", name="Submit review")
        soon(dlg.get_by_role("radio").first).to_be_focused()
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(cursor).to_have_attribute("data-cursor", "true")


def test_wf_screen_reader_review_approve_tab_trap(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        click(pg.get_by_role("button", name="Review changes", exact=True))
        dlg = pg.get_by_role("dialog", name="Submit review")
        approve = dlg.get_by_role("radio", name="Approve")
        turn_on(approve)
        trap(pg, dlg)
        soon(approve).to_be_checked()
        fill(dlg.get_by_role("textbox", name="Review summary"), f"fine-{c.tag}")
        pg.keyboard.press("Control+Enter")
        soon(dlg, ACT_MS).to_have_count(0)
        soon(action(pg), ACT_MS).to_contain_text("Review submitted.")
        soon(updates(pg), LIVE_MS).to_contain_text(ann_review(1, c.name("rev"), "approved"))
    assert change_json(w, "dev", 1)["counts"]["approvals_remaining"] == 0


def test_wf_suggestion_batch_live_comment_zone(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    body = f"zone-{c.tag}"
    with as_user(browser, w, "dev") as pg:
        open_change(pg, w)
        ok(w.api("rev", "POST", "/changes/1/threads", {"path": "b.txt", "side": "new", "line": 1, "end_line": 1, "body": body,
                                                        "suggestion": {"lines": [f"swap-{c.tag}"]}}), 201)
        art = pg.locator("[data-thread-id]").filter(has_text=body)
        soon(art.get_by_role("region", name="Suggested change").get_by_role("button", name="Apply suggestion"), LIVE_MS).to_be_visible()
        soon(updates(pg), LIVE_MS).to_contain_text(ann_comment(1, c.name("rev")))
        for when, text, zone in gg_shown_times(art):
            assert text and abs(datetime.strptime(text, "%Y-%m-%d %H:%M:%S") - when.replace(tzinfo=None)) <= timedelta(seconds=1), (text, when)
            assert zone == when.tzname(), f"time shows zone {zone!r}; {WORKSPACE_TZ.key} reads {when.tzname()!r} at {when}"


def test_wf_suggestion_batch_draft_survives_live(browser, app_url):
    c = Cast("owner", "dev", "rev")
    w = diff_world(app_url, c)
    note, draft, other = f"why-{c.tag}", f"swap-{c.tag}", f"other-{c.tag}"
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        for key in ("j", "ArrowDown", "ArrowDown"):
            pg.keyboard.press(key)
        cursor = row(pg, "a.txt", added(2, "L2"))
        soon(cursor).to_be_focused()
        pg.keyboard.press("c")
        dlg = pg.get_by_role("dialog", name=comment_dialog("a.txt", 2))
        box = dlg.get_by_role("textbox", name="Comment", exact=True)
        soon(box).to_be_focused()
        pg.keyboard.type(note)
        turn_on(dlg.get_by_role("checkbox", name="Add a suggestion"))
        lines = dlg.get_by_role("textbox", name="Suggested lines")
        fill(lines, draft)
        ok(w.api("dev", "POST", "/changes/1/threads", {"path": "b.txt", "side": "new", "line": 1, "end_line": 1, "body": other}), 201)
        soon(pg.locator("[data-thread-id]").filter(has_text=other), LIVE_MS).to_have_count(1)
        soon(box).to_have_value(note)
        soon(lines).to_have_value(draft)
        assert inside(dlg), "focus left the open comment dialog when the comment arrived"
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(cursor).to_be_focused()
        soon(cursor).to_have_attribute("data-cursor", "true")
        soon(updates(pg)).to_contain_text(ann_comment(1, c.name("dev")))


def test_wf_push_dismisses_keys_from_checkbox_switch(browser, app_url):
    c = Cast("owner", "dev", "rev")
    body = f"switch-{c.tag}"
    w = diff_world(app_url, c, extra=[S_thread("rev", "t1", "c1", "a.txt", 2, body)])
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        pg.keyboard.press("j")
        cursor = row(pg, "a.txt", unchanged(1, "l1"))
        soon(cursor).to_be_focused()
        soon(pg.get_by_text("0 of 2 files viewed")).to_be_visible()
        other_box = ga_section(pg, "b.txt").get_by_role("checkbox", name="Viewed")
        ready(other_box).focus()
        soon(other_box).to_be_focused()
        pg.keyboard.press("v")
        soon(ga_section(pg, "a.txt"), ACT_MS).to_have_attribute("data-viewed", "true")
        soon(pg.get_by_text("1 of 2 files viewed"), ACT_MS).to_be_visible()
        soon(ga_section(pg, "b.txt")).to_have_attribute("data-viewed", "false")
        soon(cursor).to_be_focused()
        switch = pg.get_by_role("switch", name="Show outdated threads")
        ready(switch).focus()
        pg.keyboard.press("n")
        soon(pg.locator("[data-thread-id]").filter(has_text=body)).to_be_focused()
        soon(row(pg, "a.txt", added(2, "L2"))).to_have_attribute("data-cursor", "true")
        soon(switch).not_to_be_checked()
    assert change_json(w, "rev", 1)["counts"]["files_viewed"] == 1


def test_wf_push_dismisses_keys_from_view_radio(browser, app_url):
    c = Cast("owner", "dev", "rev")
    body = f"radio-{c.tag}"
    w = diff_world(app_url, c, extra=[S_thread("rev", "t1", "c1", "b.txt", 1, body)])
    with as_user(browser, w, "rev") as pg:
        open_change(pg, w)
        unified = pg.get_by_role("radio", name="Unified")
        soon(unified).to_be_checked()
        ready(unified).focus()
        pg.keyboard.press("n")
        soon(pg.locator("[data-thread-id]").filter(has_text=body)).to_be_focused()
        cursor = row(pg, "b.txt", added(1, "x"))
        soon(cursor).to_have_attribute("data-cursor", "true")
        ready(unified).focus()
        pg.keyboard.press("v")
        soon(ga_section(pg, "b.txt"), ACT_MS).to_have_attribute("data-viewed", "true")
        soon(pg.get_by_text("1 of 2 files viewed"), ACT_MS).to_be_visible()
        soon(ga_section(pg, "a.txt")).to_have_attribute("data-viewed", "false")
        soon(cursor).to_be_focused()
        soon(unified).to_be_checked()
    assert change_json(w, "rev", 1)["counts"]["files_viewed"] == 1


GH_NO_REVIEW = 2147483647
GH_NO_CHANGE = 999


def test_wf_roles_boundaries_dismiss_not_found(app_url):
    c = Cast("owner", "dev", "mnt", "rev", "rdr")
    w = diff_world(app_url, c, settings={"required_approvals": 0, "required_checks": []}, extra=[S_review("rev", "rc", "c1", "request_changes", "Fix it")],
                   roles={"mnt": "maintainer", "rdr": "reader"})
    rid = w.keys["rc"]["id"]
    for who in ("dev", "rdr"):
        err(w.api(who, "POST", f"/changes/1/reviews/{GH_NO_REVIEW}/dismiss", {"reason": "x"}), 404, {"error": "Not found"})
        err(w.api(who, "POST", f"/changes/{GH_NO_CHANGE}/reviews/{rid}/dismiss", {"reason": "x"}), 404, {"error": "Not found"})
    err(w.api("dev", "POST", f"/changes/1/reviews/{rid}/dismiss", {"reason": "x"}), 403, {"error": "Only maintainers and owners can do that"})
    err(w.api("mnt", "POST", f"/changes/1/reviews/{GH_NO_REVIEW}/dismiss", {"reason": ""}), 404, {"error": "Not found"})
    ok(w.api("mnt", "POST", f"/changes/1/reviews/{rid}/dismiss", {"reason": f"handled-{c.tag}"}), 200)
    err(w.api("mnt", "POST", f"/changes/1/reviews/{rid}/dismiss", {"reason": ""}), 409, {"error": "This review is already dismissed"})
    assert change_json(w, "dev", 1)["changes_requested"] is False


def test_wf_roles_boundaries_dismiss_live_escape(browser, app_url):
    c = Cast("owner", "dev", "mnt", "rev")
    w = diff_world(app_url, c, settings={"required_approvals": 0, "required_checks": []}, extra=[S_review("rev", "rc", "c1", "request_changes", "Fix it")],
                   roles={"mnt": "maintainer"})
    body, reason = f"live-{c.tag}", f"handled-{c.tag}"
    with as_user(browser, w, "mnt") as pg:
        open_change(pg, w)
        opener = pg.get_by_role("button", name="Dismiss review", exact=True)
        ga_press(opener)
        dlg = pg.get_by_role("dialog", name="Dismiss review")
        soon(dlg.get_by_role("textbox", name="Reason")).to_be_visible()
        ok(w.api("rev", "POST", "/changes/1/threads", {"path": "a.txt", "side": "new", "line": 2, "end_line": 2, "body": body}), 201)
        soon(pg.locator("[data-thread-id]").filter(has_text=body), LIVE_MS).to_have_count(1)
        soon(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        soon(dlg).to_have_count(0)
        soon(opener).to_be_focused()
        soon(updates(pg)).to_contain_text(ann_comment(1, c.name("rev")))
        pg.keyboard.press("Enter")
        fill(dlg.get_by_role("textbox", name="Reason"), reason)
        ga_press(dlg.get_by_role("button", name="Confirm dismissal"))
        soon(action(pg), ACT_MS).to_contain_text("Review dismissed.")
        item = pg.get_by_role("list", name="Reviews").get_by_role("listitem").first
        soon(item).to_have_attribute("data-state", "dismissed")
        soon(item).to_contain_text(dismissed_by(c.name("mnt"), reason))
        soon(updates(pg), LIVE_MS).to_contain_text(ann_dismissed(1, c.name("rev")))
