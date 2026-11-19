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
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (DEPLOYED_APP, S3, addresses, advance, animations, capture, center, check, click, decode,
                      difference, fill, layout, licence_allowed, mail_from_address, open_app,
                      same_origin, select, shipped_packages, state_styles, tap, until)
from conftest import text as mail_text

COOKIE = "switchyard_session"
GRADING_KEY = os.environ.get("GRADING_KEY", "gk-switchyard-4c9e27b1")
ZONE = os.environ.get("WORKSPACE_TIME_ZONE", "America/New_York")
RETRY_COUNT = int(os.environ.get("RETRY_COUNT", "2"))
RETRY_DELAY = int(os.environ.get("RETRY_DELAY_SECONDS", "30"))
STEP_LIMIT = int(os.environ.get("STEP_LIMIT", "40"))
WAIT_MAX = int(os.environ.get("WAIT_MAX_SECONDS", "86400"))
HOOK_LIMIT = int(os.environ.get("WEBHOOK_BODY_LIMIT_BYTES", "4096"))
IDEM_WINDOW = int(os.environ.get("IDEMPOTENCY_WINDOW_SECONDS", "600"))
EDIT_HOLD = int(os.environ.get("EDIT_HOLD_SECONDS", "20"))
BREAKPOINT = int(os.environ.get("CANVAS_BREAKPOINT_PX", "720"))
ATTEMPTS = RETRY_COUNT + 1
RETRY_STEP = RETRY_DELAY + 10
TOUCH_MIN = 44
IMPORT_LIMIT = 262144
GRID_COLS, GRID_ROWS = 24, 12
VIEW_PHONE = (375, 812)
VIEW_TABLET = (768, 1024)
VIEW_DESKTOP = (1280, 800)
NUMERAL_MIN_MS, NUMERAL_MAX_MS = 250, 400
STAGGER_MIN_MS, STAGGER_MAX_MS = 20, 40
EDGE_MIN_MS, EDGE_MAX_MS = 500, 750
FADE_MIN_MS, FADE_MAX_MS = 250, 450
MOTION_SLACK_MS = 120
MOTION_FLOOR_MS = 20
WAIT_S = 60
CLOCK_SLACK_S = 10
BROWSER_SKEW_H = 7
PASSWORD = "Passw0rd-switchyard"
HTTP_TIMEOUT = 30
POLL_SECONDS = 60
POLL_STEP = 0.25
MAIL_SETTLE = 0.5
UI_TIMEOUT_MS = 20_000
DOT_REST_MS = 3000
DOT_DIFF_MAX = 0.01
SAME_PX = 2
GUEST = "Zed"
REPLAY_CUSTOMER = "Zed"
REC_SUBJECT = "Recorded subject"
GREETING = "Hello Ada"
UNCLOSED = "oops {{trigger.name"
GK = {"X-Grading-Key": GRADING_KEY}
APP_ROOT = Path("/app")
LETTERS = {"s": ("set", "Set values 1"), "f": ("filter", "Filter 1"), "b": ("branch", "Branch 1"),
           "l": ("loop", "Loop 1"), "w": ("wait", "Wait 1"), "e": ("send_email", "Send email 1"),
           "a": ("add_row", "Add row 1"), "u": ("update_row", "Update row 1"),
           "h": ("call_webhook", "Call webhook 1")}
ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "OFL-1.1"}

try:
    expect.set_options(timeout=UI_TIMEOUT_MS)
except AttributeError:
    pass

_PAUSE = threading.Event()


def poll(fn, what, seconds=POLL_SECONDS):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        _PAUSE.wait(POLL_STEP)
    pytest.fail(f"timed out waiting for {what}; last value {last!r}")


def hexid():
    return uuid.uuid4().hex[:8]


def new_tag():
    return hexid()


def slug_of(tag):
    return f"space-{tag}"


def addr(tag, role="owner"):
    return f"{role}-{tag}@x.example"


def tpl(path):
    return "{{" + path + "}}"


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt(ts):
    return parse(ts).astimezone(ZoneInfo(ZONE)).strftime("%Y-%m-%d %H:%M:%S %Z")


def published(n):
    return f"Version {n} published"


def left_on_older(k):
    return f"Runs left on older versions: {k}"


def numeral(n):
    return f"v{n}"


def no_changes(n):
    return f"The draft has no changes since version {n}"


def waiting_at(n, step_name):
    return f"Run #{n} is waiting at {step_name}"


def failed_at(n, step_name):
    return f"Run #{n} failed at {step_name}"


def run_title(n, aname):
    return f"Run #{n} of {aname}"


def view_run(n):
    return f"View run #{n}"


def settings_title(name):
    return f"Step settings: {name}"


def edge_name(src, dst):
    return f"Edge from {src} to {dst}"


def in_port(name):
    return f"Input port of {name}"


def out_port(name, port="out"):
    return f"Output port {port} of {name}"


def log_title(name):
    return f"Step log: {name}"


class Api:
    def __init__(self, base, cookie=None):
        self.base, self.cookie = base, cookie
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, cookies={COOKIE: cookie} if cookie else None)

    def request(self, method, path, body=None, **kw):
        if body is not None:
            kw["json"] = body
        return self.c.request(method, path, **kw)

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body, **kw)

    def put(self, path, body=None, **kw):
        return self.request("PUT", path, body, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)


def S(sid, kind, name, col, fields, row=2):
    return {"id": sid, "kind": kind, "name": name, "col": col, "row": row, "fields": fields}


def E(frm, to, port="out", order=1):
    return {"from": frm, "port": port, "to": to, "order": order}


def R(key, version=1, input=None, recorded=None):
    run = {"key": key, "version": version, "input": input or {}}
    if recorded:
        run["recorded"] = recorded
    return run


def content(kind, tfields, steps, edges, sample=None):
    return {"trigger": {"kind": kind, "col": 1, "row": 2, "fields": tfields, "sample": sample or {}},
            "steps": list(steps), "edges": list(edges)}


def auto(key, name, kind="manual", tfields=None, steps=(), edges=(), runs=(), sample=None, live=True,
         versions=None, draft=None):
    body = content(kind, tfields or {}, steps, edges, sample)
    a = {"key": key, "id": f"au-{hexid()}", "name": name}
    if versions is not None:
        a["versions"] = versions
    elif live:
        a["versions"] = [body]
    else:
        a["draft"] = body
    if draft is not None:
        a["draft"] = draft
    if runs:
        a["runs"] = list(runs)
    return a


def table(key, name, columns, rows=()):
    return {"key": key, "id": f"tb-{hexid()}", "name": name,
            "columns": [{"name": n, "type": t} for n, t in columns], "rows": list(rows)}


class World:
    def __init__(self, base, tag, resp, users):
        self.base, self.tag = base, tag
        w = resp["workspaces"]["w"]
        self.id, self.slug = w["id"], w["slug"]
        self.autos, self.tables = w["automations"], w["tables"]
        self.user = {u["key"]: u for u in users}
        self.cookie = {k: v["cookie"] for k, v in resp["users"].items()}
        self._apis = {}

    def api(self, role="owner"):
        if role not in self._apis:
            self._apis[role] = Api(self.base, self.cookie[role])
        return self._apis[role]

    def aid(self, key):
        return self.autos[key]["id"]

    def rid(self, akey, rkey):
        return self.autos[akey]["runs"][rkey]

    def tid(self, key):
        return self.tables[key]["id"]

    def email(self, role="owner"):
        return self.user[role]["email"]

    def uname(self, role):
        return self.user[role]["name"]

    def url(self, tail=""):
        return f"/w/{self.id}{tail}"

    def editor(self, akey):
        return self.url(f"/automations/{self.aid(akey)}")

    def apath(self, akey, tail=""):
        return f"/api/workspaces/{self.id}/automations/{self.aid(akey)}{tail}"

    def draft(self, akey, role="owner"):
        return self.api(role).get(self.apath(akey)).json()

    def runs(self, role="owner", **q):
        return self.api(role).get(f"/api/workspaces/{self.id}/runs", params=q).json()["runs"]

    def start(self, akey, role="owner", **body):
        r = self.api(role).post(self.apath(akey, "/runs"), body)
        assert r.status_code == 201, r.text
        return r.json()["run_id"], r.json()["number"]

    def now(self):
        return self.api().get(f"/api/workspaces/{self.id}").json()["now"]

    def tick(self, seconds):
        r = httpx.post(f"{self.base}/api/grading/workspaces/{self.id}/clock", json={"advance_seconds": seconds},
                       headers=GK, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        return r.json()

    def clock_set(self, instant):
        r = httpx.post(f"{self.base}/api/grading/workspaces/{self.id}/clock", json={"set": instant},
                       headers=GK, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        return r.json()

    def settle_retries(self):
        for _ in range(ATTEMPTS):
            self.tick(RETRY_STEP)


def make_world(base, automations=(), tables=(), clock=None, tag=None, roles=("owner", "editor", "viewer")):
    tag = tag or new_tag()
    users = [{"key": r, "email": addr(tag, r), "name": f"{r.title()}{tag}", "password": PASSWORD} for r in roles]
    ws = {"key": "w", "id": f"ws-{tag}", "name": f"Space {tag}", "slug": slug_of(tag),
          "members": [{"user": r, "role": r} for r in roles], "tables": list(tables),
          "automations": list(automations)}
    if clock:
        ws["clock"] = {"set": clock}
    r = httpx.post(base + "/api/grading/setup", json={"users": users, "workspaces": [ws]}, headers=GK, timeout=120)
    assert r.status_code == 200, r.text
    return World(base, tag, r.json(), users)


def run_detail(w, rid, role="owner"):
    r = w.api(role).get(f"/api/workspaces/{w.id}/runs/{rid}")
    assert r.status_code == 200, r.text
    return r.json()


def by_id(d):
    return {s["id"]: s for s in d["steps"]}


def version_content(resp):
    d = resp.json()
    return {k: d[k] for k in ("version", "name", "trigger", "steps", "edges")}


def wait_run(w, rid, status, role="owner"):
    def check_status():
        d = run_detail(w, rid, role)
        return d if d["status"] == status else None
    return poll(check_status, f"run {rid} to be {status}")


def mails_to(mail, address, expected=1):
    def f():
        got = [m for m in mail.messages(expected=0, settle=MAIL_SETTLE)
               if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
        return got if len(got) >= expected else None
    return poll(f, f"{expected} mail(s) to {address}")


def mail_header(msg, name):
    hdrs = msg.get("Headers") or {}
    for k, v in hdrs.items():
        if k.lower() == name.lower():
            return v[0] if isinstance(v, list) else v
    base = os.environ.get("MAILPIT_URL")
    if base:
        data = httpx.get(f"{base}/api/v1/message/{msg['ID']}/headers", timeout=HTTP_TIMEOUT).json()
        for k, v in data.items():
            if k.lower() == name.lower():
                return v[0] if isinstance(v, list) else v
    pytest.fail(f"mail has no header {name}")


class Stream:
    def __init__(self, api, path):
        self.events, self.status, self._r = [], None, None
        self._ready = threading.Event()
        threading.Thread(target=self._run, args=(api, path), daemon=True).start()
        self._ready.wait(HTTP_TIMEOUT)

    def _run(self, api, path):
        try:
            with httpx.stream("GET", api.base + path, cookies={COOKIE: api.cookie},
                              timeout=httpx.Timeout(HTTP_TIMEOUT, read=None)) as r:
                self.status, self._r = r.status_code, r
                self._ready.set()
                for line in r.iter_lines():
                    if line.startswith("data:"):
                        try:
                            self.events.append(json.loads(line[5:]))
                        except ValueError:
                            pass
        except Exception:
            pass
        finally:
            self._ready.set()

    def close(self):
        if self._r is not None:
            self._r.close()


def hook(base, slug, path, body, key=None, ctype="application/json", method="POST"):
    headers = {"Content-Type": ctype}
    if key:
        headers["Idempotency-Key"] = key
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return httpx.request(method, f"{base}/hooks/{slug}/{path}", content=raw, headers=headers, timeout=HTTP_TIMEOUT)


@contextmanager
def ui(browser, w, role, path, size=None, before=None, **kw):
    with open_app(browser, w.base + "/", **kw) as pg:
        pg.context.add_cookies([{"name": COOKIE, "value": w.cookie[role], "url": w.base}])
        if size:
            pg.set_viewport_size({"width": size[0], "height": size[1]})
        if before:
            before(pg)
        pg.goto(w.base + path)
        yield pg


def step(pg, name):
    return pg.get_by_role("button", name=name, exact=True)


def notes(pg, name):
    return pg.get_by_role("status", name=name, exact=True)


def key(loc, k):
    loc.focus()
    loc.page.keyboard.press(k)


def put_field(box, value):
    fill(box, value)
    box.press("Tab")


def ensure_row(dlg, first_label, add_label):
    if dlg.get_by_role("textbox", name=first_label, exact=True).count() == 0:
        click(dlg.get_by_role("button", name=add_label, exact=True))


def open_settings(pg, name):
    key(step(pg, name), "Enter")
    dlg = pg.get_by_role("dialog", name=f"Step settings: {name}")
    expect(dlg).to_be_visible()
    return dlg


def summary(pg):
    return pg.get_by_role("region", name="Run summary")


def run_item(pg, number, aname):
    return pg.get_by_role("list", name="Runs").get_by_role("listitem").filter(
        has=pg.get_by_role("link", name=run_title(number, aname), exact=True))


def slow_animations(loc):
    return loc.evaluate(
        "(el, floor) => el.getAnimations({subtree: true}).filter(a => Number(a.effect.getComputedTiming().duration) >= floor).length",
        MOTION_FLOOR_MS)


def shown(pg, loc):
    if loc.count() == 0 or not loc.first.is_visible():
        return False
    b, vp = loc.first.bounding_box(), pg.viewport_size
    return bool(b) and b["x"] + b["width"] > 0 and b["x"] < vp["width"] and b["y"] + b["height"] > 0 and b["y"] < vp["height"]


def goto_cell(pg, col, row):
    cur = pg.get_by_role("group", name="Grid cursor")
    cur.focus()
    c, r = int(cur.get_attribute("data-col")), int(cur.get_attribute("data-row"))
    for _ in range(abs(col - c)):
        pg.keyboard.press("ArrowRight" if col > c else "ArrowLeft")
    for _ in range(abs(row - r)):
        pg.keyboard.press("ArrowDown" if row > r else "ArrowUp")
    expect(cur).to_have_attribute("data-col", str(col))
    expect(cur).to_have_attribute("data-row", str(row))
    return cur


def cell_xy(pg, col, row):
    box = goto_cell(pg, col, row).bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag(pg, src, dst):
    center(src)
    dst = dst() if callable(dst) else dst
    box = src.bounding_box()
    sx, sy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(sx, sy)
    pg.mouse.down()
    pg.mouse.move(dst[0], dst[1], steps=8)
    pg.mouse.up()


def wire(pg, src, dst, port="out"):
    drag(pg, pg.get_by_role("button", name=out_port(src, port), exact=True),
         lambda: center(pg.get_by_role("button", name=in_port(dst), exact=True)))


def nap(key_="a", name="Napper", seconds=WAIT_S, runs=(), **kw):
    return auto(key_, name, "manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": seconds}),
                                           S("s2", "set", "After", 3, {"values": {"x": "1"}})],
                [E("trigger", "s1"), E("s1", "s2")], runs=runs, **kw)


def failing(tag, key_="a", name="Failer", error_to=None, runs=(), extra=(), edges_extra=()):
    steps = [S("s1", "call_webhook", "Hook call", 2, {"url": f"/hooks/{slug_of(tag)}/missing", "body": {}})] + list(extra)
    edges = [E("trigger", "s1")] + list(edges_extra)
    if error_to:
        edges.append(E("s1", error_to, "error"))
    return auto(key_, name, "manual", {}, steps, edges, runs=runs)


ANIM_JS = """() => {
  window.__anims = [];
  const numeralEl = el => {
    const group = el && el.closest && el.closest('[data-live-version]');
    if (!group) return false;
    for (let n = el; n && n !== group.parentElement; n = n.parentElement) {
      if (n !== group && /^\\s*Runs left/.test(n.textContent || '')) return false;
    }
    return true;
  };
  const grab = (a, el) => {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
    window.__anims.push({duration: Number(t.duration), start: (a.startTime || 0) + (t.delay || 0),
      inGroup: numeralEl(el)});
  };
  document.addEventListener('animationstart', e => e.target.getAnimations().forEach(a => grab(a, e.target)), true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); grab(a, this); return a; };
}"""

FX_JS = """() => {
  window.__fx = [];
  const grab = (a, el) => {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
    window.__fx.push({duration: Number(t.duration), dialog: !!(el && el.closest && el.closest('[role=dialog], dialog'))});
  };
  const onEvent = e => { if (e.target.getAnimations) e.target.getAnimations().forEach(a => grab(a, e.target)); };
  document.addEventListener('animationstart', onEvent, true);
  document.addEventListener('transitionrun', onEvent, true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = orig.apply(this, args); grab(a, this); return a; };
}"""

EDGE_JS = """() => {
  window.__edge = [];
  const note = el => window.__edge.push({anim: el.dataset.anim, at: document.timeline.currentTime});
  const scan = n => { if (n.nodeType !== 1) return; if (n.dataset && n.dataset.edgeId) note(n);
    n.querySelectorAll && n.querySelectorAll('[data-edge-id]').forEach(note); };
  new MutationObserver(ms => ms.forEach(m => { if (m.type === 'childList') m.addedNodes.forEach(scan);
    else if (m.target.dataset && m.target.dataset.edgeId) note(m.target); }))
    .observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-anim']});
}"""


class Instance:
    def __init__(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
        self.proc = None

    def tail(self):
        self.log.flush()
        return Path(self.log.name).read_text()[-2000:]

    def start(self):
        manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
        env = {**os.environ, "APP_PUBLIC_PORT": str(self.port), "APP_PUBLIC_URL": self.url}
        self.proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=self.log,
                                     stderr=subprocess.STDOUT, start_new_session=True)

        def healthy():
            if self.proc.poll() is not None:
                pytest.fail(f"instance exited: {self.tail()}")
            try:
                return httpx.get(self.url + "/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                return False
        poll(healthy, "second instance health", seconds=120)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            self.proc.wait(timeout=30)


def test_wf_keyboard_build_publish_and_submit(browser, app_url, mail):
    w = make_world(app_url)
    owner = w.api()
    path, cust, name = f"kb{w.tag}", f"Ada {w.tag}", f"Keyboard {w.tag}"
    with ui(browser, w, "owner", w.url()) as pg:
        key(pg.get_by_role("button", name="New automation", exact=True), "Enter")
        dlg = pg.get_by_role("dialog", name="New automation")
        fill(dlg.get_by_role("textbox", name="Automation name"), name)
        select(dlg.get_by_role("combobox", name="Trigger"), "Form")
        key(dlg.get_by_role("button", name="Create automation", exact=True), "Enter")
        landed = re.compile(rf"/w/{w.id}/automations/(au-[0-9a-f]{{8}})(?:[?#].*)?$")
        expect(pg).to_have_url(landed)
        aid = landed.search(pg.url).group(1)
        cursor = pg.get_by_role("group", name="Grid cursor")
        cursor.focus()
        pg.keyboard.press("s")
        expect(step(pg, "Set values 1")).to_be_focused()
        pg.keyboard.press("Escape")
        expect(cursor).to_be_focused()
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("e")
        expect(step(pg, "Send email 1")).to_be_focused()
        for src, dst in (("Form trigger", "Set values 1"), ("Set values 1", "Send email 1")):
            step(pg, src).focus()
            pg.keyboard.press("c")
            expect(notes(pg, "Draft notices")).to_contain_text(
                f"Drawing an edge from {src} (out). Choose a target and press Enter.")
            pg.keyboard.press("ArrowRight")
            pg.keyboard.press("Enter")
            expect(step(pg, dst)).to_be_focused()
        d = open_settings(pg, "Form trigger")
        expect(d.get_by_role("textbox", name="Step name", exact=True)).to_be_focused()
        put_field(d.get_by_role("textbox", name="Form path", exact=True), path)
        ensure_row(d, "Field name 1", "Add form field")
        put_field(d.get_by_role("textbox", name="Field name 1", exact=True), "customer")
        put_field(d.get_by_role("textbox", name="Field label 1", exact=True), "Customer")
        pg.keyboard.press("Escape")
        expect(step(pg, "Form trigger")).to_be_focused()
        d = open_settings(pg, "Set values 1")
        ensure_row(d, "Value name 1", "Add value")
        put_field(d.get_by_role("textbox", name="Value name 1", exact=True), "greeting")
        put_field(d.get_by_role("textbox", name="Value 1", exact=True), "Hi " + tpl("trigger.customer"))
        pg.keyboard.press("Escape")
        d = open_settings(pg, "Send email 1")
        put_field(d.get_by_role("textbox", name="To", exact=True), w.email())
        put_field(d.get_by_role("textbox", name="Subject", exact=True), "Order " + tpl("trigger.customer"))
        put_field(d.get_by_role("textbox", name="Body", exact=True), tpl("steps.s1.greeting") + " " + tpl("run.id"))
        pg.keyboard.press("Escape")
        expect(notes(pg, "Draft notices")).to_contain_text("Draft saved. Not live until you publish.")

        def ready():
            dr = owner.get(f"/api/workspaces/{w.id}/automations/{aid}").json()
            sx = {s["id"]: s["fields"] for s in dr["steps"]}
            return (dr["trigger"]["fields"].get("path") == path and dr["trigger"]["fields"].get("form_fields")
                    and sx.get("s1", {}).get("values", {}).get("greeting") and sx.get("s2", {}).get("to")
                    and sx["s2"].get("subject") and sx["s2"].get("body") and len(dr["edges"]) == 2)
        poll(ready, "draft to hold typed fields and both edges")
        key(pg.get_by_role("button", name="Publish", exact=True), "Enter")
        expect(notes(pg, "Run updates")).to_contain_text(published(1))
        expect(pg.get_by_role("group", name="Version drain")).to_have_attribute("data-live-version", "1")
    with open_app(browser, f"{app_url}/forms/{w.slug}/{path}") as vp:
        expect(vp.get_by_role("heading", level=1, name=name)).to_be_visible()
        fill(vp.get_by_role("textbox", name="Customer", exact=True), cust)
        click(vp.get_by_role("button", name="Submit", exact=True))
        expect(vp.get_by_role("status").filter(has_text="Thanks, your response was received.")).to_be_visible()
    run = poll(lambda: w.runs(automation=aid) or None, "the submitted run")[0]
    d = wait_run(w, run["id"], "succeeded")
    st = by_id(d)
    assert d["version"] == 1 and st["trigger"]["output"] == {"customer": cust}
    assert st["s1"]["output"] == {"greeting": f"Hi {cust}"}
    assert st["s2"]["status"] == "succeeded" and st["s2"]["output"]["subject"] == f"Order {cust}"
    m = mails_to(mail, w.email())[0]
    assert m["Subject"] == f"Order {cust}" and run["id"] in mail_text(m)


def test_grid_cursor_and_focus_landing(browser, app_url):
    w = make_world(app_url, [auto("a", "Cursor", live=False)])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        expect(pg.get_by_role("region", name="Automation canvas")).to_be_visible()
        expect(pg.get_by_role("toolbar", name="Step kinds").get_by_role("button")).to_have_count(9)
        expect(pg.get_by_role("button", name=out_port("Manual trigger"), exact=True)).to_be_visible()
        cur = pg.get_by_role("group", name="Grid cursor")
        expect(cur).to_have_attribute("data-col", "2")
        expect(cur).to_have_attribute("data-row", "2")
        expect(step(pg, "Manual trigger")).to_have_attribute("data-col", "1")
        cur.focus()
        for _ in range(GRID_COLS + 2):
            pg.keyboard.press("ArrowRight")
        for _ in range(GRID_ROWS + 2):
            pg.keyboard.press("ArrowDown")
        expect(cur).to_have_attribute("data-col", str(GRID_COLS))
        expect(cur).to_have_attribute("data-row", str(GRID_ROWS))
        goto_cell(pg, 1, 1)
        pg.keyboard.press("ArrowLeft")
        pg.keyboard.press("ArrowUp")
        expect(cur).to_have_attribute("data-col", "1")
        expect(cur).to_have_attribute("data-row", "1")
        goto_cell(pg, 2, 2)
        for i, (letter, (kind, name)) in enumerate(LETTERS.items()):
            pg.keyboard.press(letter)
            s = step(pg, name)
            expect(s).to_be_focused()
            expect(s).to_have_attribute("data-kind", kind)
            expect(s).to_have_attribute("data-col", str(2 + i))
            pg.keyboard.press("Escape")
            expect(cur).to_be_focused()
            pg.keyboard.press("ArrowRight")
        goto_cell(pg, 2, 2)
        pg.keyboard.press("s")
        expect(notes(pg, "Draft notices")).to_contain_text("That cell is already taken")
        expect(cur).to_be_focused()
        assert len(w.draft("a")["steps"]) == len(LETTERS)
        goto_cell(pg, 12, 5)
        pg.keyboard.press("Alt+s")
        pg.keyboard.press("Control+s")
        pg.keyboard.press("Shift+S")
        expect(step(pg, "Set values 2")).to_be_focused()
        poll(lambda: len(w.draft("a")["steps"]) == len(LETTERS) + 1, "Shift+S to add exactly one step")
        step(pg, "Set values 1").focus()
        pg.keyboard.press("ArrowRight")
        expect(step(pg, "Set values 1")).to_have_attribute("data-col", "2")
        pg.keyboard.press("ArrowDown")
        expect(step(pg, "Set values 1")).to_have_attribute("data-row", "3")
        pg.keyboard.press("Delete")
        expect(cur).to_be_focused()
        expect(cur).to_have_attribute("data-row", "3")
        pg.keyboard.press("Control+z")
        expect(step(pg, "Set values 1")).to_have_attribute("data-step-id", "s1")
        expect(step(pg, "Set values 1")).to_be_focused()


def test_step_dialog_focus_wraps_and_returns(browser, app_url):
    w = make_world(app_url, [auto("a", "Dialog", live=False, steps=[S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  edges=[E("trigger", "s1")])])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        dlg = open_settings(pg, "Setter")
        first = dlg.get_by_role("textbox", name="Step name", exact=True)
        close = dlg.get_by_role("button", name="Close", exact=True)
        expect(first).to_be_focused()
        pg.keyboard.press("Shift+Tab")
        expect(close).to_be_focused()
        pg.keyboard.press("Tab")
        expect(first).to_be_focused()
        for k in ("Tab", "Shift+Tab"):
            for _ in range(20):
                pg.keyboard.press(k)
                assert dlg.evaluate("d => d.contains(document.activeElement)")
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(step(pg, "Setter")).to_be_focused()
        click(step(pg, "Setter"))
        expect(dlg).to_be_visible()
        click(close)
        expect(step(pg, "Setter")).to_be_focused()


def test_step_panel_expanders(browser, app_url):
    w = make_world(app_url, [auto("a", "Expand", live=False, steps=[S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  edges=[E("trigger", "s1")])])
    for mode in ("no-preference", "reduce"):
        with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP, reduced_motion=mode) as pg:
            dlg = open_settings(pg, "Setter")
            settings = dlg.get_by_role("button", name="Settings", exact=True)
            conn = dlg.get_by_role("button", name="Connections", exact=True)
            tmpl = dlg.get_by_role("button", name="Template help", exact=True)
            expect(settings).to_have_attribute("aria-expanded", "true")
            expect(conn).to_have_attribute("aria-expanded", "false")
            expect(tmpl).to_have_attribute("aria-expanded", "false")
            ys = [b.bounding_box() for b in (settings, conn, tmpl)]
            assert ys[0]["y"] < ys[1]["y"] < ys[2]["y"]
            pg.evaluate(FX_JS)
            click(conn)
            expect(conn).to_have_attribute("aria-expanded", "true")
            if mode == "no-preference":
                until(pg, "([lo, hi]) => window.__fx.some(a => a.dialog && a.duration >= lo && a.duration <= hi)",
                      [FADE_MIN_MS, FADE_MAX_MS])
            else:
                fx = pg.evaluate("window.__fx")
                assert not [a for a in fx if a["dialog"] and FADE_MIN_MS <= a["duration"] <= FADE_MAX_MS], fx
            key(tmpl, "Enter")
            expect(tmpl).to_have_attribute("aria-expanded", "true")
            closed = [h for h in (conn, settings) if h.get_attribute("aria-expanded") == "false"]
            if closed:
                key(closed[0], "Space")
                expect(closed[0]).to_have_attribute("aria-expanded", "true")


def test_publish_creates_numbered_version(browser, app_url):
    w = make_world(app_url, [auto("a", "Pub", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  [E("trigger", "s1")], live=False)])
    owner = w.api()
    with ui(browser, w, "owner", w.editor("a")) as pg:
        click(pg.get_by_role("button", name="Publish", exact=True))
        expect(notes(pg, "Run updates")).to_contain_text(published(1))
        expect(pg.get_by_role("group", name="Version drain")).to_contain_text(numeral(1))
        click(pg.get_by_role("button", name="Publish", exact=True))
        expect(notes(pg, "Draft notices")).to_contain_text(no_changes(1))
        r = owner.post(w.apath("a", "/publish"))
        assert r.status_code == 409 and r.json() == {"error": no_changes(1)}
        v1 = version_content(owner.get(w.apath("a", "/versions/1")))
        assert owner.put(w.apath("a", "/draft/steps/s1"), {"name": "Renamed"}).status_code == 200
        click(pg.get_by_role("button", name="Publish", exact=True))
        expect(notes(pg, "Run updates")).to_contain_text(published(2))
    vs = {v["version"]: v for v in owner.get(w.apath("a", "/versions")).json()["versions"]}
    assert vs[2]["status"] == "live" and vs[1]["status"] == "retired"
    assert version_content(owner.get(w.apath("a", "/versions/1"))) == v1


def test_send_email_confirmed_by_mailpit(app_url, mail):
    tag = new_tag()
    ghost = f"ghost-{tag}@nowhere.example"
    mailer = lambda k, to, subj: auto(k, f"Mailer {k}", "manual", {}, [S("s1", "send_email", "Mail out", 2, {
        "to": to, "subject": subj, "body": "Run " + tpl("run.id") + " for " + tpl("trigger.who")})],
        [E("trigger", "s1")], runs=[R("r1", input={"who": GUEST})])
    w = make_world(app_url, [mailer("ok", addr(tag), "Hello " + tpl("trigger.who")),
                             mailer("bad", ghost, "Nope"), mailer("case", f"  {addr(tag).upper()}  ", f"Case {tag}")],
                   tag=tag)
    rid = w.rid("ok", "r1")
    d = run_detail(w, rid)
    assert d["status"] == "succeeded" and by_id(d)["s1"]["status"] == "succeeded"
    m = [x for x in mails_to(mail, addr(tag)) if x["Subject"] == f"Hello {GUEST}"][0]
    assert addresses(m["From"]) == [mail_from_address()]
    assert f"Run {rid} for {GUEST}" in mail_text(m)
    assert mail_header(m, "X-Switchyard-Run") == rid
    assert any(x["Subject"] == f"Case {tag}" for x in mails_to(mail, addr(tag), expected=2))
    bd = run_detail(w, w.rid("bad", "r1"))
    s1 = by_id(bd)["s1"]
    assert s1["status"] != "succeeded" and "Recipient is not a workspace member: " + ghost in " ".join(s1["log"])
    assert not [x for x in mail.messages(expected=0, settle=1.5) if ghost in addresses(x.get("To"))]


def test_public_form_intake(browser, app_url):
    tag = new_tag()
    ff = [{"name": "customer", "label": "Customer", "type": "text"}, {"name": "quantity", "label": "Quantity", "type": "number"}]
    w = make_world(app_url, [auto("f", "Intake", "form", {"path": f"in{tag}", "form_fields": ff},
                                  [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")]),
                             auto("d", "Draft form", "form", {"path": f"dr{tag}", "form_fields": ff}, live=False)], tag=tag)
    api, base = Api(app_url), f"/api/forms/{w.slug}/in{tag}"
    r = api.post(base, {"customer": "Ada", "quantity": "7"})
    assert r.status_code == 202
    d = wait_run(w, r.json()["run_id"], "succeeded")
    assert d["version"] == 1 and by_id(d)["trigger"]["output"] == {"customer": "Ada", "quantity": 7}
    assert len(w.runs(automation=w.aid("f"))) == 1
    r = api.post(base, {"customer": "Bo", "quantity": 5})
    assert by_id(wait_run(w, r.json()["run_id"], "succeeded"))["trigger"]["output"]["quantity"] == 5
    r = api.post(base, {"quantity": 3})
    assert r.status_code == 422 and r.json() == {"error": "Customer is required", "field": "customer"}
    r = api.post(base, {"customer": "C", "quantity": "abc"})
    assert r.status_code == 422 and r.json() == {"error": "Quantity must be a number", "field": "quantity"}
    assert len(w.runs(automation=w.aid("f"))) == 2
    assert api.post(f"/api/forms/{w.slug}/dr{tag}", {"customer": "x", "quantity": 1}).status_code == 404
    with open_app(browser, f"{app_url}/forms/{w.slug}/dr{tag}") as vp:
        expect(vp.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()


def test_wf_keyboard_build_visitor_form(browser, app_url, mail):
    tag = new_tag()
    ff = [{"name": "customer", "label": "Customer", "type": "text"}]
    w = make_world(app_url, [auto("a", f"Visitor {tag}", "form", {"path": f"v{tag}", "form_fields": ff},
                                  [S("s1", "send_email", "Mail out", 2, {"to": addr(tag), "subject": "New " + tpl("trigger.customer"),
                                                                       "body": "Hi"})], [E("trigger", "s1")], live=False)], tag=tag)
    with open_app(browser, f"{app_url}/forms/{w.slug}/v{tag}") as vp:
        expect(vp.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()
    assert w.api().post(w.apath("a", "/publish")).status_code == 201
    with open_app(browser, f"{app_url}/forms/{w.slug}/v{tag}") as vp:
        box = vp.get_by_role("textbox", name="Customer", exact=True)
        box.focus()
        vp.keyboard.type(f"Kit{tag}")
        vp.keyboard.press("Tab")
        vp.keyboard.press("Enter")
        expect(vp.get_by_role("status").filter(has_text="Thanks, your response was received.")).to_be_visible()
    run = poll(lambda: w.runs() or None, "run from the form")[0]
    assert wait_run(w, run["id"], "succeeded")["version"] == 1
    assert any(m["Subject"] == f"New Kit{tag}" for m in mails_to(mail, addr(tag)))


def test_wf_drag_wiring_pointer_session(browser, app_url):
    w = make_world(app_url, [auto("a", "Pointer build", live=False)])
    owner = w.api()
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        for kind, name, col in (("Set values", "Set values 1", 4), ("Wait", "Wait 1", 7), ("Filter", "Filter 1", 10)):
            drag(pg, pg.get_by_role("button", name=f"Add step: {kind}", exact=True), lambda: cell_xy(pg, col, 2))
            expect(step(pg, name)).to_have_attribute("data-col", str(col))
        wire(pg, "Manual trigger", "Set values 1")
        wire(pg, "Set values 1", "Wait 1")
        expect(pg.get_by_role("button", name=edge_name("Set values 1", "Wait 1"), exact=True)).to_be_visible()
        wire(pg, "Wait 1", "Set values 1")
        expect(notes(pg, "Draft notices")).to_contain_text("That edge would close a cycle at step s1")
        assert len(w.draft("a")["edges"]) == 2
        assert owner.put(w.apath("a", "/draft/steps/s1"), {"fields": {"values": {"a": "1"}}}).status_code == 200
        assert owner.put(w.apath("a", "/draft/steps/s2"), {"fields": {"seconds": 5}}).status_code == 200
        click(pg.get_by_role("button", name="Publish", exact=True))
        expect(notes(pg, "Draft notices")).to_contain_text("Step s3 is not connected to the trigger")
        expect(step(pg, "Filter 1")).to_be_focused()
    assert w.draft("a")["live_version"] is None


def test_pointer_placement_and_wiring(browser, app_url):
    w = make_world(app_url, [auto("a", "Snap", "manual", {}, [S("s1", "set", "Mover", 4, {"values": {"a": "1"}}),
                                                         S("s2", "wait", "Anchor", 7, {"seconds": 5})], [], live=False)])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        drag(pg, step(pg, "Mover"), lambda: tuple(v + 6 for v in cell_xy(pg, 5, 5)))
        expect(step(pg, "Mover")).to_have_attribute("data-col", "5")
        expect(step(pg, "Mover")).to_have_attribute("data-row", "5")
        poll(lambda: (lambda s: s["col"] == 5 and s["row"] == 5)(w.draft("a")["steps"][0]), "saved snapped cell")
        drag(pg, step(pg, "Anchor"), lambda: cell_xy(pg, 5, 5))
        expect(notes(pg, "Draft notices")).to_contain_text("That cell is already taken")
        expect(step(pg, "Anchor")).to_have_attribute("data-col", "7")
        drag(pg, pg.get_by_role("button", name=out_port("Mover"), exact=True), lambda: cell_xy(pg, 10, 8))
        drag(pg, pg.get_by_role("button", name=in_port("Anchor"), exact=True),
             lambda: center(pg.get_by_role("button", name=in_port("Mover"), exact=True)))
        drag(pg, pg.get_by_role("button", name=out_port("Mover"), exact=True), lambda: center(step(pg, "Anchor")))
        expect(pg.get_by_role("button", name=re.compile("^Edge from"))).to_have_count(0)
        wire(pg, "Mover", "Anchor")
        expect(pg.get_by_role("button", name=edge_name("Mover", "Anchor"), exact=True)).to_be_visible()
    edges = w.draft("a")["edges"]
    assert [(e["from"], e["to"]) for e in edges] == [("s1", "s2")]


def test_wf_drag_wiring_edge_motion(browser, app_url):
    results = {}
    for mode in ("no-preference", "reduce"):
        w = make_world(app_url, [auto("a", "Motion", "manual", {}, [S("s1", "set", "Mover", 4, {"values": {"a": "1"}})], [], live=False)])
        with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP, reduced_motion=mode) as pg:
            pg.evaluate(EDGE_JS)
            wire(pg, "Manual trigger", "Mover")
            edge = pg.get_by_role("button", name=edge_name("Manual trigger", "Mover"), exact=True)
            expect(edge).to_be_visible()
            expect(edge).to_have_attribute("data-anim", "none")
            results[mode] = pg.evaluate("window.__edge")
    seen = results["no-preference"]
    run_at = next(e["at"] for e in seen if e["anim"] == "running")
    end_at = next(e["at"] for e in seen if e["anim"] == "none" and e["at"] > run_at)
    assert EDGE_MIN_MS - MOTION_SLACK_MS <= end_at - run_at <= EDGE_MAX_MS + MOTION_SLACK_MS
    assert results["reduce"] and {e["anim"] for e in results["reduce"]} == {"none"}


def test_canvas_dot_grid_static(browser, app_url):
    w = make_world(app_url, [auto("a", "Dots", live=False)])
    shots = {}
    for mode in ("no-preference", "reduce"):
        with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP, reduced_motion=mode) as pg:
            canvas = pg.get_by_role("region", name="Automation canvas")
            expect(canvas).to_be_visible()
            first = decode(capture(canvas))
            advance(pg, DOT_REST_MS)
            second = decode(capture(canvas))
            assert first.variance() > 0
            assert difference(first, second) <= DOT_DIFF_MAX
            shots[mode] = first
    assert difference(shots["no-preference"], shots["reduce"]) <= DOT_DIFF_MAX


def test_wf_drag_wiring_keyboard_edge_refusals(browser, app_url):
    w = make_world(app_url, [auto("a", "Edges", "manual", {}, [
        S("s1", "filter", "One", 2, {"left": "a", "operator": "equals", "right": "a"}), S("s2", "set", "Two", 3, {"values": {"a": "1"}}),
        S("s3", "set", "Three", 4, {"values": {"a": "1"}})], [E("trigger", "s1"), E("s1", "s2")], live=False)])
    owner, ep = w.api(), w.apath("a", "/draft/edges")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        step(pg, "Two").focus()
        pg.keyboard.press("c")
        pg.keyboard.press("ArrowLeft")
        pg.keyboard.press("Enter")
        expect(notes(pg, "Draft notices")).to_contain_text("That edge would close a cycle at step s1")
        expect(step(pg, "Two")).to_be_focused()
    assert len(w.draft("a")["edges"]) == 2
    cases = [({"from": "s9", "port": "out", "to": "s3"}, "Unknown step: s9"),
             ({"from": "s2", "port": "out", "to": "trigger"}, "The trigger cannot have an incoming edge"),
             ({"from": "s1", "port": "error", "to": "s3"}, "Step s1 has no port error"),
             ({"from": "s2", "port": "out", "to": "s1"}, "That edge would close a cycle at step s1")]
    for body, msg in cases:
        r = owner.post(ep, body)
        assert r.status_code == 422 and r.json()["error"] == msg, (body, r.text)
    r = owner.post(ep, {"from": "s1", "port": "out", "to": "s3"})
    assert r.status_code == 201 and r.json()["order"] == 2
    r = owner.post(ep, {"from": "s2", "port": "out", "to": "s3"})
    assert r.status_code == 422 and r.json()["error"] == "Step s3 already has an incoming edge"
    assert len(w.draft("a")["edges"]) == 3


def test_publish_refusals_move_focus(browser, app_url):
    tag = new_tag()
    ok = S("s1", "set", "Seed", 2, {"values": {"a": "1"}})
    ff = [{"name": "c", "label": "C", "type": "text"}]
    cases = {
        "unconnected": ("manual", {}, [ok, S("s2", "wait", "Park", 3, {"seconds": 5})], [E("trigger", "s1")],
                        "Step s2 is not connected to the trigger", "s2"),
        "required": ("manual", {}, [S("s1", "send_email", "Mail", 2, {"to": "", "subject": "x", "body": "y"})],
                     [E("trigger", "s1")], "Step s1 needs a value for To", "s1"),
        "schedule": ("schedule", {"schedule": "whenever"}, [], [],
                     "Step trigger has a schedule that is not every N minutes or daily at HH:MM", "trigger"),
        "wait_range": ("manual", {}, [S("s1", "wait", "Nap", 2, {"seconds": WAIT_MAX + 1})], [E("trigger", "s1")],
                       f"Step s1 must wait between 1 and {WAIT_MAX} seconds", "s1"),
        "foreign_url": ("manual", {}, [S("s1", "call_webhook", "Hook", 2, {"url": "http://example.org/hooks/x", "body": {}})],
                        [E("trigger", "s1")], "Step s1 can only call this app's own address", "s1"),
        "nested_loop": ("manual", {}, [S("s1", "loop", "Outer", 2, {"source": "list", "list": tpl("trigger.items")}),
                                       S("s2", "loop", "Inner", 3, {"source": "list", "list": tpl("trigger.items")})],
                        [E("trigger", "s1"), E("s1", "s2", "each")], "Step s2 is a loop inside another loop", "s2"),
        "path_taken": ("form", {"path": f"taken{tag}", "form_fields": ff}, [], [],
                       "Step trigger needs a path no other live automation uses", "trigger"),
    }
    autos = [auto(k, f"Case {k}", kind, tf, st, ed, live=False) for k, (kind, tf, st, ed, _, _) in cases.items()]
    autos.append(auto("holder", "Holder", "form", {"path": f"taken{tag}", "form_fields": ff}))
    w = make_world(app_url, autos, tag=tag)
    for k, (_, _, _, _, msg, sid) in cases.items():
        r = w.api().post(w.apath(k, "/publish"))
        assert r.status_code == 422 and r.json() == {"error": msg, "step_id": sid}, (k, r.text)
    for size in (VIEW_DESKTOP, VIEW_TABLET, VIEW_PHONE):
        with ui(browser, w, "owner", w.editor("unconnected"), size=size) as pg:
            wide = size[0] >= BREAKPOINT
            expect(pg.get_by_role("region", name="Automation canvas")).to_have_count(1 if wide else 0)
            expect(pg.get_by_role("list", name="Steps")).to_have_count(0 if wide else 1)
            click(pg.get_by_role("button", name="Publish", exact=True))
            expect(notes(pg, "Draft notices")).to_contain_text("Step s2 is not connected to the trigger")
            expect(step(pg, "Park")).to_be_focused()


def test_wf_branch_compare_opposite_ports(browser, app_url):
    w = make_world(app_url, [auto("a", "Branchy", "manual", {}, [
        S("s1", "branch", "Check amount", 2, {"left": tpl("trigger.amount"), "operator": "greater than", "right": "100"}),
        S("s2", "set", "High path", 3, {"values": {"l": "high"}}, row=1), S("s3", "set", "Low path", 3, {"values": {"l": "low"}}, row=3)],
        [E("trigger", "s1"), E("s1", "s2", "true"), E("s1", "s3", "false")])])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        for n, amount in ((1, 150), (2, 50)):
            fill(pg.get_by_role("textbox", name="Run input (JSON)"), json.dumps({"amount": amount}))
            key(pg.get_by_role("button", name="Run now", exact=True), "Enter")
            expect(pg.get_by_role("link", name=f"View run #{n}", exact=True)).to_be_visible()
        expect(notes(pg, "Run updates")).to_contain_text("Run #2 succeeded")
        for n, hi, lo in ((1, "succeeded", "skipped"), (2, "skipped", "succeeded")):
            rid = next(r["id"] for r in w.runs() if r["number"] == n)
            pg.goto(app_url + w.url(f"/runs/{rid}"))
            expect(step(pg, "High path")).to_have_attribute("data-status", hi)
            expect(step(pg, "Low path")).to_have_attribute("data-status", lo)
    for run in w.runs():
        st = by_id(run_detail(w, run["id"]))
        expected = {"result": run["number"] == 1}
        assert st["s1"]["output"] == expected


COND_CASES = [("10", "greater than", "9", True), ("abc", "less than", "abd", True), ("Apple", "equals", "apple", False),
              ("10", "greater than", "9a", False), ("1.0", "equals", "1", True), ("hello world", "contains", "lo w", True),
              ("Hello", "contains", "hello", False), ("1.0", "not equals", "1", False), (tpl("trigger.blank"), "is empty", "", True),
              ("x", "is empty", "", False), ("x", "is not empty", "", True), ("+5", "equals", "5", True),
              (" 7 ", "equals", "7", True), ("1e3", "equals", "1000", False), ("9", "less than", "10", True),
              ("9", "greater than", "10", False)]


def test_condition_comparison_rules(app_url):
    steps = [S(f"s{i + 1}", "branch", f"Cond {i + 1}", 2 + i, {"left": left, "operator": op, "right": right})
             for i, (left, op, right, _) in enumerate(COND_CASES)]
    edges = [E("trigger", s["id"], "out", i + 1) for i, s in enumerate(steps)]
    gate = auto("g", "Gate", "manual", {}, [S("s1", "filter", "Gate", 2, {"left": "a", "operator": "equals", "right": "b"}),
                                           S("s2", "set", "Later", 3, {"values": {"a": "1"}})],
                [E("trigger", "s1"), E("s1", "s2")], runs=[R("r1")])
    w = make_world(app_url, [auto("c", "Conds", "manual", {}, steps, edges, runs=[R("r1", input={"blank": "   "})]), gate])
    st = by_id(run_detail(w, w.rid("c", "r1")))
    for i, (left, op, right, expected) in enumerate(COND_CASES):
        assert st[f"s{i + 1}"]["output"] == {"result": expected}, (left, op, right)
    d = run_detail(w, w.rid("g", "r1"))
    assert d["status"] == "succeeded" and by_id(d)["s1"]["output"] == {"passed": False} and by_id(d)["s2"]["status"] == "skipped"


def test_template_typing(app_url):
    values = {"q1": tpl("trigger.qty"), "q2": "Qty: " + tpl("trigger.qty"), "f1": tpl("trigger.flag"),
              "f2": "Flag: " + tpl("trigger.flag"), "i1": tpl("trigger.items"), "i2": "Items: " + tpl("trigger.items"),
              "n1": tpl("trigger.items.1.name"), "u1": "Hi " + tpl("trigger.nope") + "!", "u2": tpl("trigger.nope"),
              "sp": "{{ trigger.name }}", "rid": tpl("run.id"), "bad": UNCLOSED, "lp": tpl("loop.index")}
    inp = {"name": "Ada", "qty": 3, "flag": True, "items": [{"name": "Pen"}, {"name": "Ink"}]}
    w = make_world(app_url, [auto("a", "Tpl", "manual", {}, [S("s1", "set", "Setter", 2, {"values": values})],
                                  [E("trigger", "s1")], runs=[R("r1", input=inp)])])
    rid = w.rid("a", "r1")
    s1 = by_id(run_detail(w, rid))["s1"]
    out = s1["output"]
    assert out["q1"] == 3 and type(out["q1"]) is int and out["q2"] == "Qty: 3"
    assert out["f1"] is True and out["f2"] == "Flag: true"
    assert out["i1"] == inp["items"] and out["i2"] == 'Items: [{"name":"Pen"},{"name":"Ink"}]'
    assert out["n1"] == "Ink" and out["u1"] == "Hi !" and out["u2"] == "" and out["sp"] == "Ada"
    assert out["rid"] == rid and out["bad"] == UNCLOSED and out["lp"] == ""
    assert "Unknown template path: trigger.nope" in s1["log"] and "Unknown template path: loop.index" in s1["log"]


def test_wf_branch_compare_announced_live(browser, app_url):
    tag = new_tag()
    w = make_world(app_url, [nap("p", "Pulse", 30), failing(tag, "b", "Boom")], tag=tag)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        assert log.inner_text().strip() == ""
        w.start("p")
        expect(log).to_contain_text(waiting_at(1, "Sleeper"))
        expect(run_item(pg, 1, "Pulse")).to_have_attribute("data-status", "waiting")
        r2, _ = w.start("p")
        expect(log).to_contain_text(waiting_at(2, "Sleeper"))
        assert w.api().post(f"/api/workspaces/{w.id}/runs/{r2}/cancel").status_code == 200
        expect(log).to_contain_text("Run #2 was cancelled")
        w.tick(40)
        expect(log).to_contain_text("Run #1 succeeded")
        w.start("b")
        w.settle_retries()
        expect(log).to_contain_text(failed_at(1, "Hook call"))
        lines = [x.strip() for x in log.inner_text().splitlines() if x.strip()]
        assert lines.count("Run #1 started") == 2 and lines.count("Run #2 started") == 1
        for s in (waiting_at(1, "Sleeper"), "Run #1 succeeded", "Run #2 was cancelled", failed_at(1, "Hook call")):
            assert lines.count(s) == 1, s
        assert not [x for x in lines if "retry" in x.lower()]


def test_step_list_keyboard_navigation(browser, app_url):
    w = make_world(app_url, [auto("a", "Listy", "manual", {}, [S(f"s{i}", "set", n, 1 + i, {"values": {"a": "1"}})
                                                          for i, n in ((1, "Alpha"), (2, "Beta"), (3, "Gamma"))],
                                  [E("trigger", "s1"), E("s1", "s2"), E("s2", "s3")], runs=[R("r1")])])
    d = run_detail(w, w.rid("a", "r1"))
    names = [s["name"] for s in d["steps"]]
    with ui(browser, w, "owner", w.url(f"/runs/{w.rid('a', 'r1')}"), size=VIEW_PHONE) as pg:
        step(pg, names[0]).focus()
        for n in names[1:]:
            pg.keyboard.press("ArrowDown")
            expect(step(pg, n)).to_be_focused()
        pg.keyboard.press("ArrowUp")
        expect(step(pg, names[-2])).to_be_focused()
        step(pg, names[0]).focus()
        pg.keyboard.press("Tab")
        expect(step(pg, names[1])).to_be_focused()
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name=log_title(names[1]))
        expect(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        expect(step(pg, names[1])).to_be_focused()
        click(step(pg, names[2]))
        click(pg.get_by_role("dialog", name=log_title(names[2])).get_by_role("button", name="Close", exact=True))
        expect(step(pg, names[2])).to_be_focused()


def loop_tables():
    return (table("src", "Source", [("customer", "text"), ("qty", "number")],
                  [{"customer": "Cobalt", "qty": 12}, {"customer": "Harbor", "qty": 40}, {"customer": "Lumen", "qty": 7}]),
            table("dst", "Followups", [("customer", "text"), ("position", "number")]))


def test_wf_loop_rows_table_loop(browser, app_url):
    src, dst = loop_tables()
    w = make_world(app_url, [auto("a", "Loopy", "manual", {}, [
        S("s1", "loop", "Each row", 2, {"source": "table", "table": src["id"]}),
        S("s2", "add_row", "Add follow-up", 3, {"table": dst["id"], "values": {"customer": tpl("loop.item.customer"),
                                                                              "position": tpl("loop.index")}})],
        [E("trigger", "s1"), E("s1", "s2", "each")], runs=[R("r1")])], tables=[src, dst])
    d = run_detail(w, w.rid("a", "r1"))
    assert d["status"] == "succeeded" and by_id(d)["s1"]["output"] == {"count": 3}
    rows = w.api().get(f"/api/workspaces/{w.id}/tables/{w.tid('dst')}").json()["rows"]
    assert [(r["customer"], r["position"]) for r in rows] == [("Cobalt", 1), ("Harbor", 2), ("Lumen", 3)]
    for size in (VIEW_PHONE, VIEW_TABLET, VIEW_DESKTOP):
        with ui(browser, w, "owner", w.url(f"/tables/{w.tid('dst')}"), size=size) as pg:
            grid = pg.get_by_role("table", name="Followups", exact=True)
            expect(grid.get_by_role("row")).to_have_count(4)
            expect(grid.get_by_role("columnheader", name="Row id")).to_be_visible()
            layout(pg)
            gb, fb = grid.bounding_box(), pg.get_by_role("textbox", name="New row: customer", exact=True).bounding_box()
            assert fb["y"] >= gb["y"] + gb["height"] - 1


def test_loop_variables(app_url):
    w = make_world(app_url, [auto("a", "Vars", "manual", {}, [
        S("s1", "loop", "Each", 2, {"source": "list", "list": tpl("trigger.items")}),
        S("s2", "set", "Body", 3, {"values": {"label": "Row " + tpl("loop.index") + ": " + tpl("loop.item.name"), "n": tpl("loop.index")}})],
        [E("trigger", "s1"), E("s1", "s2", "each")], runs=[R("r1", input={"items": [{"name": "Pen"}, {"name": "Ink"}]})])])
    st = by_id(run_detail(w, w.rid("a", "r1")))
    assert st["s1"]["output"] == {"count": 2}
    assert st["s2"]["output"] == {"label": "Row 2: Ink", "n": 2} and st["s2"]["attempts"] == 1
    assert st["s2"]["log"].count(f"Attempt 1 of {ATTEMPTS} succeeded") == 2


def test_wf_loop_rows_step_limit(browser, app_url):
    half = STEP_LIMIT // 2
    items = list(range(half + 5))
    w = make_world(app_url, [auto("a", "Limit", "manual", {}, [
        S("s1", "loop", "Spin", 2, {"source": "list", "list": tpl("trigger.items")}),
        S("s2", "set", "First body", 3, {"values": {"n": tpl("loop.index")}}),
        S("s3", "set", "Second body", 4, {"values": {"n": tpl("loop.index")}}),
        S("s4", "set", "After loop", 5, {"values": {"x": "1"}})],
        [E("trigger", "s1"), E("s1", "s2", "each"), E("s2", "s3"), E("s1", "s4", "done")])])
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        rid, _ = w.start("a", input={"items": items})
        expect(notes(pg, "Run updates")).to_contain_text(failed_at(1, "Second body"))
    d = wait_run(w, rid, "failed")
    st = by_id(d)
    assert d["message"] == f"Step limit of {STEP_LIMIT} reached"
    assert st["s1"]["status"] == "failed" and st["s4"]["status"] == "skipped"
    assert len([x for x in st["s2"]["log"] if "succeeded" in x]) == half
    assert len([x for x in st["s3"]["log"] if "succeeded" in x]) == half - 1


def test_loop_source_rules(app_url):
    src, dst = loop_tables()
    tag = new_tag()
    bad_list = auto("l", "BadList", "manual", {}, [S("s1", "loop", "Loop", 2, {"source": "list", "list": "not a list"})],
                    [E("trigger", "s1")], runs=[R("r1")])
    missing = f"tb-{hexid()}"
    bad_tab = auto("t", "BadTable", "manual", {}, [S("s1", "loop", "Loop", 2, {"source": "table", "table": missing})],
                   [E("trigger", "s1")], runs=[R("r1")])
    ids = auto("i", "RowIds", "manual", {}, [S("s1", "loop", "Loop", 2, {"source": "table", "table": src["id"]}),
                                            S("s2", "add_row", "Add", 3, {"table": dst["id"], "values": {"customer": tpl("loop.item._row_id")}})],
               [E("trigger", "s1"), E("s1", "s2", "each")], runs=[R("r1")])
    w = make_world(app_url, [bad_list, bad_tab, ids], tables=[src, dst], tag=tag)
    w.settle_retries()
    d = run_detail(w, w.rid("l", "r1"))
    assert d["status"] == "failed" and d["message"] == f"Step s1 failed after {ATTEMPTS} attempts: Loop source is not a list"
    d = run_detail(w, w.rid("t", "r1"))
    assert d["message"] == f"Step s1 failed after {ATTEMPTS} attempts: Table not found: {missing}"
    rows = w.api().get(f"/api/workspaces/{w.id}/tables/{w.tid('dst')}").json()["rows"]
    assert [r["customer"] for r in rows] == ["r1", "r2", "r3"]


def test_depth_first_execution_order(app_url, mail):
    tag = new_tag()
    dst = table("dst", "Out", [("n", "number")])
    steps = [S("s1", "set", "One", 2, {"values": {"a": "1"}}),
             S("s2", "loop", "Loop", 3, {"source": "list", "list": tpl("trigger.items")}),
             S("s3", "add_row", "Row", 4, {"table": dst["id"], "values": {"n": tpl("loop.index")}}, row=1),
             S("s4", "set", "Two", 4, {"values": {"a": "2"}}, row=3),
             S("s5", "send_email", "Five", 3, {"to": addr(tag), "subject": "five-" + tag, "body": "b"}, row=4),
             S("s6", "send_email", "Six", 5, {"to": addr(tag), "subject": "six-" + tag, "body": "b"})]
    edges = [E("trigger", "s1"), E("s1", "s5", "out", 2), E("s1", "s2", "out", 1), E("s2", "s4", "each", 2),
             E("s2", "s3", "each", 1), E("s2", "s6", "done", 1)]
    w = make_world(app_url, [auto("a", "Order", "manual", {}, steps, edges, runs=[R("r1", input={"items": [{"n": 1}, {"n": 2}]})])],
                   tables=[dst], tag=tag)
    d = wait_run(w, w.rid("a", "r1"), "succeeded")
    assert [s["id"] for s in d["steps"]] == ["trigger", "s1", "s2", "s3", "s4", "s6", "s5"]
    assert by_id(d)["s3"]["log"].count(f"Attempt 1 of {ATTEMPTS} succeeded") == 2
    assert len(w.api().get(f"/api/workspaces/{w.id}/tables/{w.tid('dst')}").json()["rows"]) == 2
    assert {m["Subject"] for m in mails_to(mail, addr(tag), expected=2)} >= {"five-" + tag, "six-" + tag}


def test_wf_wait_cancel_resume_on_server_clock(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    d = run_detail(w, rid)
    s1 = by_id(d)["s1"]
    assert d["status"] == "waiting" and s1["status"] == "waiting"
    assert 0 < (parse(s1["due_at"]) - parse(w.now())).total_seconds() <= WAIT_S
    with ui(browser, w, "editor", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        expect(summary(pg)).to_have_attribute("data-status", "waiting")
        w.tick(WAIT_S // 2)
        assert run_detail(w, rid)["status"] == "waiting"
        expect(summary(pg)).to_have_attribute("data-status", "waiting")
        w.tick(WAIT_S // 2 + CLOCK_SLACK_S)
        d = run_detail(w, rid)
        assert d["status"] == "succeeded" and d["version"] == 1 and by_id(d)["s2"]["status"] == "succeeded"
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")
        expect(summary(pg)).to_contain_text("Version 1")


def test_wf_wait_cancel_live_list(browser, app_url):
    w = make_world(app_url, [nap(name="Liveness")])
    with ui(browser, w, "editor", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        w.start("a")
        item = run_item(pg, 1, "Liveness")
        expect(item).to_have_attribute("data-status", "waiting")
        expect(notes(pg, "Run updates")).to_contain_text(waiting_at(1, "Sleeper"))
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(item).to_have_attribute("data-status", "succeeded")
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 succeeded")


def test_wf_wait_cancel_keyboard_cancel(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        key(pg.get_by_role("button", name="Cancel run", exact=True), "Enter")
        expect(summary(pg)).to_have_attribute("data-status", "cancelled")
        expect(step(pg, "Sleeper")).to_have_attribute("data-status", "cancelled")
        expect(step(pg, "After")).to_have_attribute("data-status", "skipped")
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 was cancelled")
        expect(pg.get_by_role("button", name="Cancel run", exact=True)).to_be_disabled()
    w.tick(WAIT_S * 3)
    d = run_detail(w, rid)
    assert d["status"] == "cancelled" and by_id(d)["s1"]["status"] == "cancelled" and by_id(d)["s2"]["status"] == "skipped"


def test_finished_runs_refuse_cancel(app_url):
    w = make_world(app_url, [auto("a", "Done", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  [E("trigger", "s1")], runs=[R("r1"), R("r2", recorded={"status": "failed", "failed_step": "s1",
                                                                                          "steps": {"s1": {"status": "failed", "message": "x"}}})])])
    owner = w.api()
    for rk, n in (("r1", 1), ("r2", 2)):
        r = owner.post(f"/api/workspaces/{w.id}/runs/{w.rid('a', rk)}/cancel")
        assert r.status_code == 409 and r.json() == {"error": f"Run #{n} has already finished"}
    assert run_detail(w, w.rid("a", "r1"))["status"] == "succeeded"


def test_wf_wait_cancel_browser_clock_ignored(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    d = run_detail(w, rid)
    skew = iso(parse(w.now()) + timedelta(hours=BROWSER_SKEW_H))
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP, before=lambda p: p.clock.set_fixed_time(skew)) as pg:
        expect(summary(pg)).to_have_attribute("data-status", "waiting")
        expect(summary(pg)).to_contain_text("Started " + fmt(d["started_at"]))
        click(step(pg, "Sleeper"))
        log = pg.get_by_role("dialog", name=log_title("Sleeper"))
        expect(log.get_by_role("group", name="Timing")).to_contain_text("Due: " + fmt(by_id(d)["s1"]["due_at"]))
        click(log.get_by_role("button", name="Close", exact=True))
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")


def test_wf_retry_error_path_error_edge(browser, app_url, mail):
    tag = new_tag()
    mailer = S("s2", "send_email", "Fallback mail", 3, {"to": addr(tag), "subject": "fallback-" + tag, "body": "b"})
    w = make_world(app_url, [failing(tag, error_to="s2", extra=[mailer], runs=[R("r1")])], tag=tag)
    rid = w.rid("a", "r1")
    skew = iso(parse(w.now()) + timedelta(hours=BROWSER_SKEW_H))
    with ui(browser, w, "editor", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP, before=lambda p: p.clock.set_fixed_time(skew)) as pg:
        expect(step(pg, "Hook call")).to_have_attribute("data-status", "retrying")
        w.settle_retries()
        expect(step(pg, "Hook call")).to_have_attribute("data-status", "failed")
        expect(step(pg, "Fallback mail")).to_have_attribute("data-status", "succeeded")
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")
    assert any(m["Subject"] == "fallback-" + tag for m in mails_to(mail, addr(tag)))


def test_attempt_log_lines_and_settings(app_url):
    tag = new_tag()
    w = make_world(app_url, [failing(tag, runs=[R("r1")])], tag=tag)
    rid = w.rid("a", "r1")
    s1 = by_id(run_detail(w, rid))["s1"]
    assert s1["status"] == "retrying" and s1["attempts"] == 1
    assert s1["log"] == [f"Attempt 1 of {ATTEMPTS} failed: Webhook answered 404"]
    assert 0 < (parse(s1["retry_at"]) - parse(w.now())).total_seconds() <= RETRY_DELAY
    w.tick(RETRY_DELAY // 2)
    assert len(by_id(run_detail(w, rid))["s1"]["log"]) == 1
    w.tick(RETRY_DELAY // 2 + CLOCK_SLACK_S)
    assert len(by_id(run_detail(w, rid))["s1"]["log"]) == 2
    w.settle_retries()
    d = run_detail(w, rid)
    assert d["status"] == "failed" and by_id(d)["s1"]["attempts"] == ATTEMPTS
    assert by_id(d)["s1"]["log"] == [f"Attempt {n} of {ATTEMPTS} failed: Webhook answered 404" for n in range(1, ATTEMPTS + 1)]


def test_error_edge_keeps_step_failed(app_url):
    t = table("t", "Nums", [("qty", "number")])
    w = make_world(app_url, [auto("a", "Err", "manual", {}, [
        S("s1", "add_row", "Bad add", 2, {"table": t["id"], "values": {"qty": "abc"}}),
        S("s2", "set", "Handler", 3, {"values": {"h": "1"}}, row=1), S("s3", "set", "Normal next", 3, {"values": {"n": "1"}}, row=3)],
        [E("trigger", "s1"), E("s1", "s2", "error"), E("s1", "s3", "out")], runs=[R("r1")])], tables=[t])
    w.settle_retries()
    d = run_detail(w, w.rid("a", "r1"))
    st = by_id(d)
    assert d["status"] == "succeeded" and st["s1"]["status"] == "failed" and st["s2"]["status"] == "succeeded"
    assert st["s3"]["status"] == "skipped"
    assert st["s1"]["log"][-1] == f"Attempt {ATTEMPTS} of {ATTEMPTS} failed: Column qty must be a number"


def test_wf_retry_error_path_run_failure(browser, app_url):
    tag = new_tag()
    ghost = f"ghost-{tag}@nowhere.example"
    nxt = S("s2", "set", "Never", 3, {"values": {"a": "1"}})
    bad_mail = auto("m", "Ghost mail", "manual", {}, [S("s1", "send_email", "Mail out", 2, {"to": ghost, "subject": "x", "body": "y"})],
                    [E("trigger", "s1")], runs=[R("r1")])
    w = make_world(app_url, [failing(tag, extra=[nxt], edges_extra=[E("s1", "s2")], runs=[R("r1")]), bad_mail], tag=tag)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        w.settle_retries()
        expect(notes(pg, "Run updates")).to_contain_text(failed_at(1, "Hook call"))
    d = run_detail(w, w.rid("a", "r1"))
    assert d["status"] == "failed" and d["message"] == f"Step s1 failed after {ATTEMPTS} attempts: Webhook answered 404"
    d = run_detail(w, w.rid("m", "r1"))
    assert d["message"] == f"Step s1 failed after {ATTEMPTS} attempts: Recipient is not a workspace member: {ghost}"


def test_wf_retry_error_path_mail_outage(app_url, mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    tag = new_tag()
    send = lambda: S("s1", "send_email", "Mail out", 2, {"to": addr(tag), "subject": "down-" + tag, "body": "b"})
    handler = S("s2", "set", "Handler", 3, {"values": {"h": "1"}})
    w = make_world(base, [auto("e", "WithError", "manual", {}, [send(), handler], [E("trigger", "s1"), E("s1", "s2", "error")], runs=[R("r1")]),
                          auto("n", "NoError", "manual", {}, [send()], [E("trigger", "s1")], runs=[R("r1")])], tag=tag)
    assert by_id(run_detail(w, w.rid("e", "r1")))["s1"]["status"] == "retrying"
    w.settle_retries()
    d = run_detail(w, w.rid("e", "r1"))
    assert d["status"] == "succeeded" and by_id(d)["s1"]["status"] == "failed" and by_id(d)["s2"]["status"] == "succeeded"
    d = run_detail(w, w.rid("n", "r1"))
    assert d["status"] == "failed" and d["message"] == f"Step s1 failed after {ATTEMPTS} attempts: Mail server did not accept the message"
    assert not [m for m in mail.messages(expected=0, settle=1.5) if addr(tag) in addresses(m.get("To"))]


def export_world(app_url, base=None):
    tag = new_tag()
    ff = [{"name": "customer", "label": "Customer", "type": "text"}]
    return make_world(base or app_url, [auto("a", "Exported", "form", {"path": f"ex{tag}", "form_fields": ff},
                                           [S("s1", "set", "Setter", 2, {"values": {"g": "hi"}})], [E("trigger", "s1")],
                                           sample={"customer": "A"})], tag=tag)


def test_wf_export_import_journey(browser, app_url, tmp_path):
    w = export_world(app_url)
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        with pg.expect_download() as dl:
            key(pg.get_by_role("button", name="Export live version", exact=True), "Enter")
        saved = tmp_path / "export.json"
        dl.value.save_as(saved)
        expect(notes(pg, "Notices")).to_contain_text("Export saved")
        pg.goto(app_url + w.url())
        click(pg.get_by_role("button", name="Import automation", exact=True))
        pg.get_by_label("Automation file").set_input_files(str(saved))
        landed = re.compile(rf"/w/{w.id}/automations/(au-[0-9a-f]{{8}})(?:[?#].*)?$")
        expect(pg).to_have_url(landed)
        expect(notes(pg, "Draft notices")).to_contain_text("Import saved. This is a draft.")
        new_id = landed.search(pg.url).group(1)
    raw = saved.read_bytes()
    assert S3().get(f"exports/{w.id}/{w.aid('a')}/v1.json") == raw
    keys = S3().keys(f"imports/{w.id}/")
    assert len(keys) == 1 and S3().get(keys[0]) == raw
    new = w.api().get(f"/api/workspaces/{w.id}/automations/{new_id}").json()
    old = w.draft("a")
    assert new_id != w.aid("a") and new["live_version"] is None
    assert [(s["id"], s["kind"], s["name"], s["fields"]) for s in new["steps"]] == [(s["id"], s["kind"], s["name"], s["fields"]) for s in old["steps"]]


def test_export_bytes_match_storage(app_url):
    w = export_world(app_url)
    owner = w.api()
    r = owner.post(w.apath("a", "/versions/1/export"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert "attachment" in r.headers["content-disposition"]
    assert S3().get(f"exports/{w.id}/{w.aid('a')}/v1.json") == r.content
    assert owner.post(w.apath("a", "/versions/1/export")).content == r.content
    assert owner.post(w.apath("a", "/versions/9/export")).status_code == 404


def valid_file(w):
    return w.api().post(w.apath("a", "/versions/1/export")).content


def upload(w, raw, role="owner"):
    return w.api(role).post(f"/api/workspaces/{w.id}/imports", content=raw, headers={"Content-Type": "application/json"})


def test_export_format_and_import_validation(app_url):
    w = export_world(app_url)
    raw = valid_file(w)
    doc = json.loads(raw)
    assert doc["format"] == "switchyard-automation" and doc["format_version"] == 1 and "name" in doc
    assert {"kind", "col", "row", "fields", "sample"} <= set(doc["trigger"])
    assert all({"id", "kind", "name", "col", "row", "fields"} <= set(s) for s in doc["steps"])
    assert all({"from", "port", "to", "order"} <= set(e) for e in doc["edges"])
    assert not re.search(r"\d{4}-\d{2}-\d{2}T", raw.decode())
    bad_step = {**doc, "steps": [{**doc["steps"][0], "kind": "teleport"}]}
    bad_trig = {**doc, "trigger": {**doc["trigger"], "kind": "pigeon"}}
    cyc = {**doc, "edges": doc["edges"] + [{"from": "s1", "port": "out", "to": "s1", "order": 1}]}
    cases = [(b"not json {", "Import is not valid JSON"), (json.dumps({"format": "other", "format_version": 1}).encode(),
                                                         "Import is not a Switchyard automation"),
             (json.dumps(bad_step).encode(), "Unknown node kind: teleport"), (json.dumps(bad_trig).encode(), "Unknown node kind: pigeon"),
             (json.dumps(cyc).encode(), "That edge would close a cycle at step s1")]
    before = (S3().keys(f"imports/{w.id}/"), len(w.api().get(f"/api/workspaces/{w.id}/automations").json()["automations"]))
    for body, msg in cases:
        r = upload(w, body)
        assert r.status_code == 422 and r.json()["error"] == msg, (msg, r.text)
    assert (S3().keys(f"imports/{w.id}/"), len(w.api().get(f"/api/workspaces/{w.id}/automations").json()["automations"])) == before


def test_import_stored_as_uploaded(app_url):
    w = export_world(app_url)
    doc = json.loads(valid_file(w))
    raw = ("\t" + json.dumps(doc, indent=4, sort_keys=True, ensure_ascii=False) + "\n\n").encode()
    r = upload(w, raw, "editor")
    assert r.status_code == 201
    j = r.json()
    assert re.fullmatch(r"im-[0-9a-f]{8}", j["import_id"]) and re.fullmatch(r"au-[0-9a-f]{8}", j["automation_id"])
    assert j["key"] == f"imports/{w.id}/{j['import_id']}.json" and S3().get(j["key"]) == raw
    new = w.api().get(f"/api/workspaces/{w.id}/automations/{j['automation_id']}").json()
    assert new["live_version"] is None and [s["id"] for s in new["steps"]] == [s["id"] for s in doc["steps"]]
    base = json.dumps(doc).encode()
    exact = base + b" " * (IMPORT_LIMIT - len(base))
    assert upload(w, exact).status_code == 201
    keys_before = S3().keys(f"imports/{w.id}/")
    r = upload(w, exact + b" ")
    assert r.status_code == 413 and r.json() == {"error": f"Body is larger than {IMPORT_LIMIT} bytes"}
    assert S3().keys(f"imports/{w.id}/") == keys_before


def test_wf_export_import_storage_outage(browser, app_url, tmp_path):
    base = os.environ["APP_MINIO_DOWN_URL"]
    w = export_world(app_url, base)
    raw = valid_file(export_world(app_url))
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "unavailable"}
    r = w.api().post(w.apath("a", "/versions/1/export"))
    assert r.status_code == 503 and r.json() == {"error": "Storage is unavailable"}
    r = upload(w, raw)
    assert r.status_code == 503 and r.json() == {"error": "Storage is unavailable"}
    f = tmp_path / "in.json"
    f.write_bytes(raw)
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        downloads = []
        pg.on("download", lambda d: downloads.append(d))
        click(pg.get_by_role("button", name="Export live version", exact=True))
        expect(pg.get_by_role("alert").filter(has_text="Storage is unavailable. Nothing was saved.")).to_be_visible()
        assert not downloads
        expect(notes(pg, "Notices")).not_to_contain_text("Export saved")
        pg.goto(base + w.url())
        click(pg.get_by_role("button", name="Import automation", exact=True))
        pg.get_by_label("Automation file").set_input_files(str(f))
        expect(pg.get_by_role("alert").filter(has_text="Storage is unavailable. Nothing was saved.")).to_be_visible()
    assert not S3().keys(f"exports/{w.id}/") and not S3().keys(f"imports/{w.id}/")


def hook_world(app_url, n=1):
    tag = new_tag()
    autos = [auto(f"h{i}", f"Intake hook {i}", "webhook", {"path": f"hk{i}-{tag}"},
                  [S("s1", "set", "Echo", 2, {"values": {"got": tpl("trigger.order")}})], [E("trigger", "s1")]) for i in range(n)]
    autos.append(auto("d", "Draft hook", "webhook", {"path": f"dr-{tag}"}, live=False))
    return make_world(app_url, autos, tag=tag)


def test_wf_webhook_intake_live_run_list(browser, app_url):
    w = hook_world(app_url)
    path = f"hk0-{w.tag}"
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        r1 = hook(app_url, w.slug, path, {"order": "A1"}, key=f"k-{w.tag}")
        assert r1.status_code == 202 and r1.json()["replayed"] is False
        expect(run_item(pg, 1, "Intake hook 0")).to_be_visible()
        r2 = hook(app_url, w.slug, path, {"order": "A1"}, key=f"k-{w.tag}")
        assert r2.status_code == 200 and r2.json() == {"run_id": r1.json()["run_id"], "replayed": True}
        hook(app_url, w.slug, path, {"order": "A2"}, key=f"k2-{w.tag}")
        expect(run_item(pg, 2, "Intake hook 0")).to_be_visible()
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 2")
        lines = [x.strip() for x in notes(pg, "Run updates").inner_text().splitlines()]
        assert lines.count("Run #1 started") == 1 and lines.count("Run #2 started") == 1
    d = wait_run(w, r1.json()["run_id"], "succeeded")
    assert by_id(d)["trigger"]["output"] == {"order": "A1"} and len(w.runs()) == 2


def test_webhook_refusal_order(app_url):
    w = hook_world(app_url)
    path, aid = f"hk0-{w.tag}", w.aid("h0")
    big = b"x" * (HOOK_LIMIT + 1)
    r = hook(app_url, w.slug, f"nope-{w.tag}", {"a": 1}, method="GET")
    assert r.status_code == 404 and r.json() == {"error": "Not found"}
    assert hook(app_url, w.slug, f"dr-{w.tag}", {"a": 1}).status_code == 404
    r = hook(app_url, w.slug, path, big, method="PUT", ctype="text/plain")
    assert r.status_code == 405 and r.headers["allow"] == "POST" and r.json() == {"error": "Method not allowed"}
    r = hook(app_url, w.slug, path, big, ctype="text/plain")
    assert r.status_code == 413 and r.json() == {"error": f"Body is larger than {HOOK_LIMIT} bytes"}
    r = hook(app_url, w.slug, path, b"{bad", ctype="text/plain")
    assert r.status_code == 415 and r.json() == {"error": "Content type must be application/json or application/x-www-form-urlencoded"}
    r = hook(app_url, w.slug, path, b"{bad", key=f"k-{w.tag}")
    assert r.status_code == 422 and r.json() == {"error": "Body is not valid JSON"}
    r = hook(app_url, w.slug, path, b"[1]")
    assert r.status_code == 422 and r.json() == {"error": "Body must be a JSON object"}
    assert not w.runs(automation=aid)
    r = hook(app_url, w.slug, path, {"order": "ok"}, key=f"k-{w.tag}")
    assert r.status_code == 202 and r.json()["replayed"] is False
    r = hook(app_url, w.slug, path, b"order=1&order=2", ctype="application/x-www-form-urlencoded")
    assert by_id(wait_run(w, r.json()["run_id"], "succeeded"))["trigger"]["output"] == {"order": "2"}
    assert hook(app_url, w.slug, path, {"order": "n"}).status_code == 202
    assert hook(app_url, w.slug, path, {"order": "n"}).status_code == 202
    assert len(w.runs(automation=aid)) == 4


def test_wf_webhook_intake_body_limit_boundary(app_url):
    w = hook_world(app_url)
    path, aid = f"hk0-{w.tag}", w.aid("h0")
    pad = lambda n: b'{"p":"' + b"a" * (n - 8) + b'"}'
    assert len(pad(HOOK_LIMIT)) == HOOK_LIMIT
    assert hook(app_url, w.slug, path, pad(HOOK_LIMIT)).status_code == 202
    r = hook(app_url, w.slug, path, pad(HOOK_LIMIT + 1))
    assert r.status_code == 413 and r.json() == {"error": f"Body is larger than {HOOK_LIMIT} bytes"}
    assert len(w.runs(automation=aid)) == 1


def test_idempotent_webhook_replay_and_conflict(app_url):
    w = hook_world(app_url, 2)
    p0, p1, k = f"hk0-{w.tag}", f"hk1-{w.tag}", f"key-{w.tag}"
    first = hook(app_url, w.slug, p0, b'{"order":"1"}', key=k).json()["run_id"]
    r = hook(app_url, w.slug, p0, b'{"order":"1"}', key=k)
    assert r.status_code == 200 and r.json() == {"run_id": first, "replayed": True}
    r = hook(app_url, w.slug, p0, b'{"order": "1"}', key=k)
    assert r.status_code == 409 and r.json() == {"error": "Idempotency-Key was already used with a different body"}
    assert hook(app_url, w.slug, p1, b'{"order":"1"}', key=k).status_code == 202
    assert hook(app_url, w.slug, p0, b'{"order":"1"}', key=k + "-2").status_code == 202
    assert len(w.runs(automation=w.aid("h0"))) == 2


def test_idempotency_window_on_workspace_clock(app_url):
    w = hook_world(app_url)
    path, k = f"hk0-{w.tag}", f"key-{w.tag}"
    first = hook(app_url, w.slug, path, {"order": "1"}, key=k).json()["run_id"]
    w.tick(IDEM_WINDOW // 2)
    assert hook(app_url, w.slug, path, {"order": "1"}, key=k).json() == {"run_id": first, "replayed": True}
    assert hook(app_url, w.slug, path, {"order": "2"}, key=k).status_code == 409
    w.tick(IDEM_WINDOW // 2 + CLOCK_SLACK_S * 2)
    r = hook(app_url, w.slug, path, {"order": "1"}, key=k)
    assert r.status_code == 202 and r.json()["replayed"] is False and r.json()["run_id"] != first


def sched_world(app_url, schedule, clock, name="Sched"):
    return make_world(app_url, [auto("a", name, "schedule", {"schedule": schedule}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                     [E("trigger", "s1")])], clock=clock)


def fired(w, akey="a"):
    out = []
    for run in w.runs(automation=w.aid(akey)):
        out.append(parse(run_detail(w, run["id"])["trigger"]["fired_at"]))
    return sorted(out)


def utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_spring_forward_daily_schedule(app_url):
    w = sched_world(app_url, "daily at 02:30", "2027-03-13T05:00:00Z")
    w.clock_set("2027-03-14T08:00:00Z")
    assert fired(w) == [utc(2027, 3, 13, 7, 30), utc(2027, 3, 14, 7, 0)]


def test_fall_back_daily_schedule(app_url):
    w = sched_world(app_url, "daily at 01:30", "2027-11-06T20:00:00Z")
    w.clock_set("2027-11-07T12:00:00Z")
    assert fired(w) == [utc(2027, 11, 7, 5, 30)]
    w.clock_set("2027-11-08T12:00:00Z")
    assert fired(w) == [utc(2027, 11, 7, 5, 30), utc(2027, 11, 8, 6, 30)]


def test_interval_schedule(app_url):
    t0 = datetime(2027, 3, 13, 12, 0, tzinfo=timezone.utc)
    w = sched_world(app_url, "every 10 minutes", iso(t0))
    w.tick(35 * 60)
    got = fired(w)
    assert len(got) == 3
    for g, k in zip(got, (1, 2, 3)):
        assert abs((g - (t0 + timedelta(minutes=10 * k))).total_seconds()) <= CLOCK_SLACK_S
    owner = w.api()
    assert owner.put(w.apath("a", "/draft/steps/trigger"), {"fields": {"schedule": "every 60 minutes"}}).status_code == 200
    assert owner.post(w.apath("a", "/publish")).json()["version"] == 2
    w.tick(30 * 60)
    assert len(w.runs(automation=w.aid("a"))) == 3
    w.tick(31 * 60)
    runs = w.runs(automation=w.aid("a"))
    assert len(runs) == 4 and sorted(r["version"] for r in runs) == [1, 1, 1, 2]
    assert len({r["id"] for r in runs}) == 4


def test_wf_schedule_dst_phone_journey(browser, app_url):
    w = make_world(app_url, [
        auto("d", "Daily", "schedule", {"schedule": "daily at 02:30"}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")]),
        auto("i", "Hourly12", "schedule", {"schedule": "every 720 minutes"}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")])],
        clock="2027-03-13T05:00:00Z")
    w.clock_set("2027-03-14T08:00:00Z")
    assert len(fired(w, "d")) == 2 and len(fired(w, "i")) == 2
    runs = w.runs()
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_PHONE) as pg:
        expect(notes(pg, "Run list results")).to_contain_text(f"Runs shown: {len(runs)}")
        for r in runs:
            expect(run_item(pg, r["number"], r["automation_name"])).to_contain_text("Started " + fmt(r["started_at"]))
        layout(pg)


def test_wf_schedule_dst_zone_display(browser, app_url):
    w = sched_world(app_url, "daily at 02:30", "2027-03-13T05:00:00Z", "ZoneSched")
    w.clock_set("2027-03-14T08:00:00Z")
    runs = w.runs()
    auto_row = w.api().get(f"/api/workspaces/{w.id}/automations").json()["automations"][0]
    ctx = browser.new_context(timezone_id="Asia/Kolkata", viewport={"width": VIEW_DESKTOP[0], "height": VIEW_DESKTOP[1]})
    try:
        ctx.add_cookies([{"name": COOKIE, "value": w.cookie["owner"], "url": app_url}])
        pg = ctx.new_page()
        pg.clock.set_fixed_time(iso(parse(w.now()) + timedelta(hours=BROWSER_SKEW_H)))
        pg.goto(app_url + w.url("/runs"))
        for r in runs:
            expect(run_item(pg, r["number"], "ZoneSched")).to_contain_text("Started " + fmt(r["started_at"]))
        expect(pg.get_by_role("contentinfo")).to_contain_text(f"Times are shown in {ZONE}")
        pg.goto(app_url + w.url())
        expect(pg.get_by_role("list", name="Automations")).to_contain_text(fmt(auto_row["next_run_at"]))
    finally:
        ctx.close()


def test_wf_version_pinning_journey(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    owner, r1 = w.api(), w.rid("a", "r1")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        grp = pg.get_by_role("group", name="Version drain")
        expect(grp).to_have_attribute("data-live-version", "1")
        assert owner.put(w.apath("a", "/draft/steps/s2"), {"name": "After v2"}).status_code == 200
        click(pg.get_by_role("button", name="Publish", exact=True))
        expect(grp).to_have_attribute("data-live-version", "2")
        expect(grp).to_have_attribute("data-drain-count", "1")
        expect(grp).to_contain_text(left_on_older(1))
        expect(notes(pg, "Run updates")).to_contain_text(published(2))
        new_run, _ = w.start("a")
        assert run_detail(w, new_run)["version"] == 2 and run_detail(w, r1)["version"] == 1
        w.tick(WAIT_S + CLOCK_SLACK_S)
        d = run_detail(w, r1)
        assert d["status"] == "succeeded" and d["version"] == 1
        expect(grp).to_have_attribute("data-drain-count", "0")
        expect(notes(pg, "Run updates")).to_contain_text(left_on_older(0))


def test_versions_immutable_and_drain(app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    owner = w.api()
    v1 = version_content(owner.get(w.apath("a", "/versions/1")))
    owner.put(w.apath("a", "/draft/steps/s2"), {"name": "Renamed"})
    assert owner.post(w.apath("a", "/publish")).json()["version"] == 2
    vs = {v["version"]: v for v in owner.get(w.apath("a", "/versions")).json()["versions"]}
    assert vs[1]["status"] == "draining" and vs[1]["runs_left"] == 1 and vs[2]["status"] == "live"
    assert version_content(owner.get(w.apath("a", "/versions/1"))) == v1
    assert [s["name"] for s in owner.get(w.apath("a", "/versions/2")).json()["steps"]] == ["Sleeper", "Renamed"]
    w.tick(WAIT_S + CLOCK_SLACK_S)
    owner.put(w.apath("a", "/draft/steps/s2"), {"name": "Again"})
    assert owner.post(w.apath("a", "/publish")).json()["version"] == 3
    vs = {v["version"]: v["status"] for v in owner.get(w.apath("a", "/versions")).json()["versions"]}
    assert vs == {1: "retired", 2: "retired", 3: "live"}
    assert version_content(owner.get(w.apath("a", "/versions/1"))) == v1


def test_wf_version_pinning_numeral_and_counter(browser, app_url):
    w = make_world(app_url, [nap(live=False)])
    owner = w.api()
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        grp, log = pg.get_by_role("group", name="Version drain"), notes(pg, "Run updates")
        expect(grp).to_contain_text("No version")
        assert owner.post(w.apath("a", "/publish")).status_code == 201
        expect(grp).to_have_attribute("data-live-version", "1")
        expect(grp).to_contain_text(numeral(1))
        expect(log).to_contain_text(published(1))
        assert "Runs left on older versions" not in log.inner_text()
        w.start("a")
        owner.put(w.apath("a", "/draft/steps/s2"), {"name": "Changed"})
        assert owner.post(w.apath("a", "/publish")).status_code == 201
        expect(grp).to_have_attribute("data-drain-count", "1")
        expect(log).to_contain_text(left_on_older(1))
        text_ = log.inner_text()
        assert text_.index(published(2)) < text_.index(left_on_older(1))
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(grp).to_contain_text(left_on_older(0))
        expect(log).to_contain_text(left_on_older(0))


def test_run_tokens_and_ghost_edges(browser, app_url):
    v1 = content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}), S("s2", "set", "After", 3, {"values": {"x": "1"}})],
                 [E("trigger", "s1"), E("s1", "s2")])
    v2 = content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}), S("s2", "set", "After two", 3, {"values": {"x": "2"}})],
                 [E("trigger", "s1"), E("s1", "s2")])
    w = make_world(app_url, [auto("a", "Ghosts", versions=[v1, v2], runs=[R("old", 1), R("new", 2)])])
    old, new = w.rid("a", "old"), w.rid("a", "new")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        t_old, t_new = pg.locator(f'[data-run-token="{old}"]'), pg.locator(f'[data-run-token="{new}"]')
        expect(t_old).to_have_attribute("data-at-step", "s1")
        expect(t_old).to_have_attribute("data-version", "1")
        expect(t_new).to_have_attribute("data-version", "2")
        ghosts = pg.locator('[data-ghost="true"]')
        poll(lambda: "1" in ghosts.evaluate_all("els => els.map(e => e.dataset.version)"), "ghost edges labelled with version 1")
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(ghosts).to_have_count(0)
        expect(t_old).to_have_count(0)


def test_wf_version_pinning_drain_motion(browser, app_url):
    results = {}
    for mode in ("no-preference", "reduce"):
        w = make_world(app_url, [nap(runs=[R("r1")], draft=content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}),
                                                                                  S("s2", "set", "After changed", 3, {"values": {"x": "1"}})],
                                                                [E("trigger", "s1"), E("s1", "s2")]))])
        with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP, reduced_motion=mode) as pg:
            pg.evaluate(ANIM_JS)
            click(pg.get_by_role("button", name="Publish", exact=True))
            grp = pg.get_by_role("group", name="Version drain")
            expect(grp).to_have_attribute("data-live-version", "2")
            expect(grp).to_contain_text(left_on_older(1))
            expect(notes(pg, "Run updates")).to_contain_text(left_on_older(1))
            if mode == "no-preference":
                until(pg, "() => window.__anims.some(a => a.inGroup)")
            results[mode] = [a for a in pg.evaluate("window.__anims") if a["inGroup"]]
            expect(grp).to_contain_text(numeral(2))
    durs = [a for a in results["no-preference"] if NUMERAL_MIN_MS <= a["duration"] <= NUMERAL_MAX_MS]
    assert durs, results["no-preference"]
    starts = sorted(a["start"] for a in durs)
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert not gaps or any(STAGGER_MIN_MS - MOTION_SLACK_MS / 4 <= g <= STAGGER_MAX_MS + MOTION_SLACK_MS / 4 for g in gaps), gaps
    assert not [a for a in results["reduce"] if a["duration"] >= MOTION_FLOOR_MS], results["reduce"]


def coedit_world(app_url):
    return make_world(app_url, [auto("a", "Shared", "manual", {}, [S("s1", "wait", "Pause", 2, {"seconds": 5})], [E("trigger", "s1")], live=False)])


def test_wf_co_editing_journey(browser, app_url):
    w = coedit_world(app_url)
    me, other = w.uname("owner"), w.uname("editor")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as a, ui(browser, w, "editor", w.editor("a"), size=VIEW_DESKTOP) as b:
        expect(notes(a, "Draft notices")).to_contain_text(f"{other} is also editing this draft")
        expect(notes(b, "Draft notices")).to_contain_text(f"{me} is also editing this draft")
        da, db = open_settings(a, "Pause"), open_settings(b, "Pause")
        fa, fb = da.get_by_role("spinbutton", name="Seconds"), db.get_by_role("spinbutton", name="Seconds")
        fill(fb, "7")
        fb.press("Enter")
        expect(fa).to_have_value("7")
        fill(fa, "9")
        fa.press("Enter")
        expect(notes(a, "Draft notices")).to_contain_text(f"{other} is editing Pause. Your change was not saved.")
        expect(fa).to_have_value("7")
        w.tick(EDIT_HOLD + CLOCK_SLACK_S)
        fill(fa, "9")
        fa.press("Enter")
        expect(fb).to_have_value("9")
    assert w.draft("a")["steps"][0]["fields"]["seconds"] == 9


def test_presence_notice(browser, app_url):
    w = coedit_world(app_url)
    me, other = w.uname("owner"), w.uname("editor")
    with ui(browser, w, "owner", w.editor("a")) as a:
        note = notes(a, "Draft notices")
        with ui(browser, w, "owner", w.editor("a")) as a2:
            expect(a2.get_by_role("group", name="Version drain")).to_be_visible()
            expect(notes(a2, "Draft notices")).to_be_attached()
            with ui(browser, w, "editor", w.editor("a")):
                expect(note).to_contain_text(f"{other} is also editing this draft")
                expect(notes(a2, "Draft notices")).to_contain_text(f"{other} is also editing this draft")
                assert f"{me} is also editing" not in note.inner_text()
                assert f"{me} is also editing" not in notes(a2, "Draft notices").inner_text()
            expect(note).not_to_contain_text(f"{other} is also editing this draft")


def test_held_step_refuses_another_member(app_url):
    w = coedit_world(app_url)
    a, b, ep = w.api("owner"), w.api("editor"), w.apath("a", "/draft/steps/s1")
    assert b.put(ep, {"fields": {"seconds": 7}}).status_code == 200
    r = a.put(ep, {"fields": {"seconds": 9}})
    assert r.status_code == 409
    j = r.json()
    assert j["error"] == f"{w.uname('editor')} is editing Pause. Your change was not saved." and j["step"]["fields"]["seconds"] == 7
    assert w.draft("a")["steps"][0]["fields"]["seconds"] == 7
    assert a.put(ep, {"col": 6, "row": 4}).status_code == 200
    assert b.put(ep, {"fields": {"seconds": 8}}).status_code == 200


def test_hold_lapses_on_workspace_clock(app_url):
    w = coedit_world(app_url)
    a, b, ep = w.api("owner"), w.api("editor"), w.apath("a", "/draft/steps/s1")
    assert b.put(ep, {"fields": {"seconds": 7}}).status_code == 200
    s = Stream(b, f"/api/workspaces/{w.id}/events?draft={w.aid('a')}")
    assert s.status == 200
    w.tick(EDIT_HOLD + CLOCK_SLACK_S)
    assert a.put(ep, {"fields": {"seconds": 9}}).status_code == 200
    poll(lambda: any(e["type"] == "draft" and e["step_id"] == "s1" and e["workspace_id"] == w.id for e in s.events), "draft push")
    s.close()
    assert w.draft("a")["steps"][0]["fields"]["seconds"] == 9
    r = b.put(ep, {"fields": {"seconds": 6}})
    assert r.status_code == 409 and r.json()["error"].startswith(f"{w.uname('owner')} is editing")


def test_simultaneous_first_saves(app_url):
    w = coedit_world(app_url)
    owner, editor = w.api("owner"), w.api("editor")
    for i in range(3):
        sid = owner.post(w.apath("a", "/draft/steps"), {"kind": "wait", "col": 4 + i, "row": 5}).json()["id"]
        out, gate = {}, threading.Barrier(2)

        def save(who, api, secs):
            gate.wait()
            out[who] = (api.put(w.apath("a", f"/draft/steps/{sid}"), {"fields": {"seconds": secs}}), secs)
        ts = [threading.Thread(target=save, args=("owner", owner, 3)), threading.Thread(target=save, args=("editor", editor, 4))]
        [t.start() for t in ts]
        [t.join(HTTP_TIMEOUT) for t in ts]
        codes = sorted(r.status_code for r, _ in out.values())
        assert codes == [200, 409], codes
        winner = next(k for k, (r, _) in out.items() if r.status_code == 200)
        loser = next(k for k, (r, _) in out.items() if r.status_code == 409)
        body = out[loser][0].json()
        assert body["error"] == f"{w.uname(winner)} is editing {body['step']['name']}. Your change was not saved."
        assert next(s for s in w.draft("a")["steps"] if s["id"] == sid)["fields"]["seconds"] == out[winner][1]


def test_wf_live_run_list_failed_filter(browser, app_url):
    tag = new_tag()
    w = make_world(app_url, [auto("ok", "Fine", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")]),
                             failing(tag, "bad", "Broken")], tag=tag)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        select(pg.get_by_role("combobox", name="Status"), "failed")
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 0")
        ok_run, _ = w.start("ok")
        wait_run(w, ok_run, "succeeded")
        w.start("bad")
        w.settle_retries()
        expect(run_item(pg, 1, "Broken")).to_have_attribute("data-status", "failed")
        expect(run_item(pg, 1, "Fine")).to_have_count(0)
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 1")


def test_test_runs_hidden_by_default(browser, app_url):
    w = make_world(app_url, [auto("a", "Tester", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  [E("trigger", "s1")], sample={"k": "v"})])
    rid, _ = w.start("a", test=True)
    d = wait_run(w, rid, "succeeded")
    assert d["test"] is True and d["version"] is None and by_id(d)["trigger"]["output"] == {"k": "v"}
    assert w.runs() == [] and [r["id"] for r in w.runs(test="true")] == [rid]
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 0")
        check(pg.get_by_role("checkbox", name="Show test runs"))
        item = run_item(pg, 1, "Tester")
        expect(item).to_have_attribute("data-test", "true")
        expect(item).to_contain_text("Test")
        expect(item).to_contain_text("Draft")
        click(pg.get_by_role("link", name=run_title(1, "Tester"), exact=True))
        expect(summary(pg)).to_have_attribute("data-test", "true")
        expect(summary(pg)).to_contain_text("Draft")


def test_streams_stay_in_workspace(app_url):
    mk = lambda: make_world(app_url, [auto("a", "Plain", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                           [E("trigger", "s1")], runs=[R("r1")])])
    w1, w2 = mk(), mk()
    s = Stream(w1.api(), f"/api/workspaces/{w1.id}/events")
    assert s.status == 200
    other, _ = w2.start("a")
    mine, _ = w1.start("a")
    poll(lambda: any(e["type"] == "run" and e["run"]["id"] == mine for e in s.events), "own run event")
    s.close()
    assert all(e["workspace_id"] == w1.id for e in s.events)
    assert not any(e["type"] == "run" and e["run"]["id"] == other for e in s.events)
    assert other not in [r["id"] for r in w1.runs()]
    r = w1.api().get(f"/api/workspaces/{w2.id}/runs/{other}")
    assert r.status_code == 404 and r.json() == {"error": "Not found"}
    assert w1.api().get(f"/api/workspaces/{w2.id}/events").status_code == 404
    assert w1.api().get(f"/api/workspaces/{w1.id}/runs", params={"automation": w2.aid("a")}).status_code == 404


def test_wf_live_run_list_filters_by_keyboard(browser, app_url):
    one = lambda k, n, runs: auto(k, n, "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")], runs=runs)
    fail = R("r2", recorded={"status": "failed", "failed_step": "s1", "steps": {"s1": {"status": "failed", "message": "boom"}}})
    w = make_world(app_url, [one("a", "Alpha", [R("r1"), fail]), one("b", "Beta", [R("r1")])])
    w.start("a", test=True)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        status = notes(pg, "Run list results")
        expect(status).to_contain_text("Runs shown: 3")
        st = pg.get_by_role("combobox", name="Status")
        st.focus()
        select(st, "failed")
        expect(status).to_contain_text("Runs shown: 1")
        st.focus()
        select(st, "All")
        au = pg.get_by_role("combobox", name="Automation")
        au.focus()
        select(au, "Beta")
        expect(status).to_contain_text("Runs shown: 1")
        au.focus()
        select(au, "All automations")
        cb = pg.get_by_role("checkbox", name="Show test runs")
        cb.focus()
        pg.keyboard.press("Space")
        expect(status).to_contain_text("Runs shown: 4")


def replay_world(app_url):
    tag = new_tag()
    ff = [{"name": "customer", "label": "Customer", "type": "text"}]
    rec = {"status": "failed", "failed_step": "s2", "steps": {
        "s1": {"status": "succeeded", "output": {"to": addr(tag), "subject": REC_SUBJECT}},
        "s2": {"status": "failed", "message": "Webhook answered 404"}}}
    return make_world(app_url, [auto("a", "Intake", "form", {"path": f"in{tag}", "form_fields": ff}, [
        S("s1", "send_email", "Mail out", 2, {"to": addr(tag), "subject": "New " + tpl("trigger.customer"), "body": "Hi"}),
        S("s2", "call_webhook", "Hook call", 3, {"url": f"/hooks/{slug_of(tag)}/missing", "body": {}})],
        [E("trigger", "s1"), E("s1", "s2")], sample={"customer": "A"},
        runs=[R("r1", input={"customer": "A"}), R("r2", input={"customer": REPLAY_CUSTOMER}, recorded=rec)])], tag=tag)


def owner_mails(mail, w):
    return [m for m in mail.messages(expected=0, settle=1.5) if w.email() in addresses(m.get("To"))]


def test_wf_replay_from_step_journey(browser, app_url, mail):
    w = replay_world(app_url)
    rid = w.rid("a", "r2")
    mails_to(mail, w.email())
    before = len(owner_mails(mail, w))
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        select(pg.get_by_role("combobox", name="Replay from", exact=True), "Hook call")
        click(pg.get_by_role("button", name="Replay", exact=True))
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/run-[0-9a-f]{{8}}$"))
        new_id = pg.url.rsplit("/", 1)[1]
        assert new_id != rid
        expect(summary(pg)).to_have_attribute("data-replay-of", rid)
        expect(step(pg, "Mail out")).to_have_attribute("data-reused", "true")
        expect(step(pg, "Hook call")).to_have_attribute("data-reused", "false")
        pg.reload()
        expect(pg.get_by_role("heading", level=1, name=run_title(3, "Intake"))).to_be_visible()
    assert len(owner_mails(mail, w)) == before


def test_replay_reuses_recorded_outputs(app_url, mail):
    w = replay_world(app_url)
    rid, owner = w.rid("a", "r2"), w.api()
    mails_to(mail, w.email())
    before = len(owner_mails(mail, w))
    r = owner.post(f"/api/workspaces/{w.id}/runs/{rid}/replay", {"from_step": "s2"})
    assert r.status_code == 201
    d = run_detail(w, r.json()["run_id"])
    st = by_id(d)
    assert d["replay_of"] == rid and d["version"] == 1 and r.json()["number"] == 3
    assert st["trigger"]["output"] == {"customer": REPLAY_CUSTOMER} and st["trigger"]["log"] == ["Reused output from run #2"]
    assert st["s1"]["reused"] is True and st["s1"]["output"]["subject"] == REC_SUBJECT
    assert "Reused output from run #2" in st["s1"]["log"] and st["s2"]["reused"] is False
    assert len(owner_mails(mail, w)) == before
    r = owner.post(f"/api/workspaces/{w.id}/runs/{rid}/replay", {"from_step": "trigger"})
    assert r.status_code == 201 and by_id(run_detail(w, r.json()["run_id"]))["s1"]["reused"] is False
    assert any(m["Subject"] == f"New {REPLAY_CUSTOMER}" for m in mails_to(mail, w.email(), expected=2))


def test_replay_refusals(app_url):
    fail = lambda at, steps: R("r1", recorded={"status": "failed", "failed_step": at, "steps": steps})
    sset = lambda i, n, c, row=2: S(i, "set", n, c, {"values": {"a": "1"}}, row)
    after = auto("b", "After", "manual", {}, [sset("s1", "One", 2), sset("s2", "Two", 3)], [E("trigger", "s1"), E("s1", "s2")],
                 runs=[fail("s1", {"s1": {"status": "failed", "message": "x"}})])
    loop = auto("l", "Looped", "manual", {}, [S("s1", "loop", "Spin", 2, {"source": "list", "list": tpl("trigger.items")}), sset("s2", "Body", 3)],
                [E("trigger", "s1"), E("s1", "s2", "each")], runs=[fail("s2", {"s1": {"status": "succeeded", "output": {"count": 1}},
                                                                               "s2": {"status": "failed", "message": "x"}})])
    w = make_world(app_url, [nap(runs=[R("r1")]), after, loop])
    o = w.api()
    rp = lambda ak, frm: o.post(f"/api/workspaces/{w.id}/runs/{w.rid(ak, 'r1')}/replay", {"from_step": frm})
    r = rp("a", "s1")
    assert r.status_code == 409 and r.json() == {"error": "Only a failed run can be replayed"}
    r = rp("b", "s2")
    assert r.status_code == 422 and r.json() == {"error": "Replay must start at or before the failed step"}
    r = rp("l", "s2")
    assert r.status_code == 422 and r.json() == {"error": "Replay cannot start inside a loop"}
    assert rp("l", "s1").status_code == 201
    assert len(w.runs(automation=w.aid("b"))) == 1


def test_wf_replay_landing_announced(browser, app_url):
    w = replay_world(app_url)
    with ui(browser, w, "owner", w.url(f"/runs/{w.rid('a', 'r2')}"), size=VIEW_DESKTOP) as pg:
        select(pg.get_by_role("combobox", name="Replay from", exact=True), "Mail out")
        click(pg.get_by_role("button", name="Replay", exact=True))
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/run-[0-9a-f]{{8}}$"))
        expect(pg.get_by_role("heading", level=1, name=run_title(3, "Intake"))).to_be_visible()
        log = notes(pg, "Run updates")
        expect(log).to_contain_text("Run #3 started")
        assert [x.strip() for x in log.inner_text().splitlines()].count("Run #3 started") == 1


def test_wf_replay_keyboard_live_to_others(browser, app_url):
    w = replay_world(app_url)
    rid = w.rid("a", "r2")
    with ui(browser, w, "viewer", w.url("/runs"), size=VIEW_DESKTOP) as v, ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as o:
        box = o.get_by_role("combobox", name="Replay from", exact=True)
        select(box, "Hook call")
        box.focus()
        o.keyboard.press("Tab")
        expect(o.get_by_role("button", name="Replay", exact=True)).to_be_focused()
        o.keyboard.press("Enter")
        expect(o).to_have_url(re.compile(r"/runs/run-[0-9a-f]{8}$"))
        expect(v.locator(f'[data-replay-of="{rid}"]')).to_have_count(1)
        expect(run_item(v, 3, "Intake")).to_be_visible()


def phone_world(app_url):
    return make_world(app_url, [auto("a", "Phoned", "manual", {}, [S("s1", "set", "Greeter", 2, {"values": {"greeting": GREETING}}),
                                                                 S("s2", "wait", "Sleeper", 3, {"seconds": 30}),
                                                                 S("s3", "set", "After", 4, {"values": {"x": "1"}})],
                                  [E("trigger", "s1"), E("s1", "s2"), E("s2", "s3")], runs=[R("r1")])])


def list_rows(pg):
    return pg.get_by_role("list", name="Steps").get_by_role("listitem").evaluate_all(
        "els => els.map(e => [e.dataset.stepId, e.dataset.kind, e.dataset.status])")


def test_wf_phone_run_log_step_list(browser, app_url):
    w = phone_world(app_url)
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        poll(lambda: list_rows(pg) == [[s["id"], s["kind"], s["status"]] for s in run_detail(w, rid)["steps"]],
             "the phone step list to match the run detail")
        w.tick(30 + CLOCK_SLACK_S)
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 succeeded")
        poll(lambda: list_rows(pg) == [[s["id"], s["kind"], s["status"]] for s in run_detail(w, rid)["steps"]],
             "the phone step list to follow the finished run")
        pg.set_viewport_size({"width": VIEW_DESKTOP[0], "height": VIEW_DESKTOP[1]})
        expect(pg.get_by_role("list", name="Steps")).to_have_count(0)
        expect(step(pg, "Greeter")).to_have_attribute("data-step-id", "s1")


def test_wf_phone_run_log_step_log_touch(browser, app_url):
    w = phone_world(app_url)
    rid = w.rid("a", "r1")
    w.tick(30 + CLOCK_SLACK_S)
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        tap(step(pg, "Greeter"))
        dlg = pg.get_by_role("dialog", name=log_title("Greeter"))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("succeeded")
        expect(dlg.get_by_role("group", name="Input")).to_be_visible()
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(json.dumps({"greeting": GREETING}, indent=2))
        expect(dlg.get_by_role("group", name="Attempts")).to_contain_text("Attempts: 1")
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Started: ")
        expect(dlg.get_by_role("list", name="Log")).to_be_visible()
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_phone_run_log_breakpoint_exact(browser, app_url):
    w = phone_world(app_url)
    for path, canvas_or_step in ((w.editor("a"), None), (w.url(f"/runs/{w.rid('a', 'r1')}"), "Greeter")):
        with ui(browser, w, "owner", path, size=(BREAKPOINT, 800)) as pg:
            expect(pg.get_by_role("list", name="Steps")).to_have_count(0)
            if canvas_or_step:
                expect(step(pg, canvas_or_step)).to_be_visible()
            else:
                expect(pg.get_by_role("region", name="Automation canvas")).to_be_visible()
            pg.set_viewport_size({"width": BREAKPOINT - 1, "height": 800})
            expect(pg.get_by_role("list", name="Steps")).to_be_visible()
            if not canvas_or_step:
                expect(pg.get_by_role("region", name="Automation canvas")).to_have_count(0)


def test_touch_targets_no_sideways_scroll(browser, app_url):
    w = phone_world(app_url)
    for path in (w.url(), w.editor("a"), w.url(f"/runs/{w.rid('a', 'r1')}"), w.url("/runs")):
        with ui(browser, w, "owner", path, size=VIEW_PHONE, reduced_motion="reduce") as pg:
            layout(pg)
            for role in ("button", "combobox", "textbox", "checkbox"):
                for loc in pg.get_by_role(role).all():
                    if loc.is_visible():
                        box = loc.bounding_box()
                        assert box["width"] >= TOUCH_MIN - 0.5 and box["height"] >= TOUCH_MIN - 0.5, (path, role, box)
            if path == w.editor("a"):
                assert slow_animations(pg.get_by_role("group", name="Version drain")) == 0


def test_wf_viewer_boundaries_invite_journey(browser, app_url, mail):
    w = make_world(app_url, [nap(name="Visible one")], roles=("owner",))
    other = make_world(app_url, roles=("owner",))
    invitee = f"viewer-{new_tag()}@x.example"
    with ui(browser, w, "owner", w.url("/members"), size=VIEW_DESKTOP) as pg:
        fill(pg.get_by_role("textbox", name="Invitee email"), invitee)
        select(pg.get_by_role("combobox", name="Role"), "viewer")
        click(pg.get_by_role("button", name="Send invite", exact=True))
        expect(notes(pg, "Notices")).to_contain_text(f"Invite sent to {invitee}")
    m = mails_to(mail, invitee)[0]
    assert m["Subject"] == f"{w.uname('owner')} invited you to Space {w.tag} on Pinbyte Switchyard"
    link = re.search(r"https?://\S+?(/invite/[\w-]+)", mail_text(m)).group(1)
    with open_app(browser, app_url + link) as vp:
        expect(vp.get_by_role("heading", level=1, name=f"Join Space {w.tag}")).to_be_visible()
        fill(vp.get_by_role("textbox", name="Name"), "Vera Viewer")
        fill(vp.get_by_role("textbox", name="Password"), PASSWORD)
        click(vp.get_by_role("button", name="Join workspace", exact=True))
        expect(vp).to_have_url(re.compile(rf"/w/{w.id}$"))
        expect(vp.get_by_role("list", name="Automations")).to_contain_text("Visible one")
        new = vp.get_by_role("button", name="New automation", exact=True)
        expect(new).to_be_disabled()
        expect(new).to_have_accessible_description("Viewers cannot change this workspace")
        vp.goto(app_url + other.url())
        expect(vp.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()


def test_viewer_refusals(browser, app_url):
    rec = R("r2", recorded={"status": "failed", "failed_step": "s1", "steps": {"s1": {"status": "failed", "message": "x"}}})
    w = make_world(app_url, [nap(runs=[R("r1"), rec])], tables=[table("t", "Tab", [("c", "text")])])
    v, ws, ep = w.api("viewer"), f"/api/workspaces/{w.id}", w.apath("a")
    calls = [("POST", f"{ws}/automations", {"name": "x", "trigger_kind": "manual"}), ("PUT", ep + "/draft/steps/s1", {"name": "x"}),
             ("POST", ep + "/draft/steps", {"kind": "set", "col": 8, "row": 8}), ("POST", ep + "/publish", None),
             ("POST", ep + "/runs", {}), ("POST", f"{ws}/runs/{w.rid('a', 'r1')}/cancel", None),
             ("POST", f"{ws}/runs/{w.rid('a', 'r2')}/replay", {"from_step": "s1"}), ("POST", ep + "/versions/1/export", None),
             ("POST", f"{ws}/tables", {"name": "n", "columns": [{"name": "c", "type": "text"}]}),
             ("POST", f"{ws}/tables/{w.tid('t')}/rows", {"values": {"c": "v"}}),
             ("POST", f"{ws}/invites", {"email": "a@b.example", "role": "viewer"})]
    rev = w.draft("a")["revision"]
    for method, path, body in calls:
        r = v.request(method, path, body)
        assert r.status_code == 403 and r.json() == {"error": "Viewers cannot change this workspace"}, (path, r.text)
    assert upload(w, b"{}", "viewer").json() == {"error": "Viewers cannot change this workspace"}
    assert w.draft("a")["revision"] == rev and v.get(ep).status_code == 200
    r = w.api("editor").post(f"{ws}/invites", {"email": "a@b.example", "role": "viewer"})
    assert r.status_code == 403 and r.json() == {"error": "Only owners can do this"}
    reason = "Viewers cannot change this workspace"
    with ui(browser, w, "viewer", w.editor("a"), size=VIEW_DESKTOP) as pg:
        for name in ("Test run", "Publish", "Export live version", "Add step: Set values", "Add step: Call webhook"):
            b = pg.get_by_role("button", name=name, exact=True)
            expect(b).to_be_disabled()
            expect(b).to_have_accessible_description(reason)
    with ui(browser, w, "viewer", w.url(), size=VIEW_DESKTOP) as pg:
        for name in ("New automation", "Import automation"):
            expect(pg.get_by_role("button", name=name, exact=True)).to_be_disabled()
    with ui(browser, w, "editor", w.url("/members"), size=VIEW_DESKTOP) as pg:
        b = pg.get_by_role("button", name="Send invite", exact=True)
        expect(b).to_be_disabled()
        expect(b).to_have_accessible_description("Only owners can do this")


def test_other_workspaces_answer_not_found(browser, app_url):
    mine = make_world(app_url, roles=("owner",))
    theirs = make_world(app_url, [nap(runs=[R("r1")])], tables=[table("t", "Tab", [("c", "text")])], roles=("owner",))
    o = mine.api()
    paths = [f"/api/workspaces/{theirs.id}", f"/api/workspaces/{theirs.id}/members", f"/api/workspaces/{theirs.id}/tables/{theirs.tid('t')}",
             theirs.apath("a"), f"/api/workspaces/{theirs.id}/runs/{theirs.rid('a', 'r1')}", f"/api/workspaces/ws-{hexid()}"]
    for p in paths:
        r = o.get(p)
        assert r.status_code == 404 and r.json() == {"error": "Not found"}, p
    assert o.post(theirs.apath("a", "/publish")).status_code == 404
    with ui(browser, mine, "owner", mine.url(), size=VIEW_DESKTOP) as pg:
        for addr_ in (theirs.url(), theirs.editor("a"), theirs.url(f"/runs/{theirs.rid('a', 'r1')}"), theirs.url(f"/tables/{theirs.tid('t')}")):
            pg.goto(app_url + addr_)
            expect(pg.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()
    anon = Api(app_url)
    r = anon.get("/api/me")
    assert r.status_code == 401 and r.json() == {"error": "Sign in required"}
    r = anon.post(f"/api/workspaces/{mine.id}/tables", {"name": "n"}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json() == {"error": "Cross-origin request refused"}
    body = {"name": "n", "columns": [{"name": "c", "type": "text"}]}
    assert o.post(f"/api/workspaces/{mine.id}/tables", body, headers={"Origin": "http://evil.example"}).status_code == 403
    assert o.post(f"/api/workspaces/{mine.id}/tables", body, headers={"Origin": app_url}).status_code == 201
    r = anon.get("/api/nothing-here-" + mine.tag)
    assert r.status_code == 404 and r.json() == {"error": "Not found"}


def test_not_found_page(browser, app_url):
    with open_app(browser, f"{app_url}/no-such-page-{new_tag()}") as pg:
        expect(pg.get_by_role("heading", level=1, name="We couldn't find that page")).to_be_visible()
        expect(pg.get_by_text("It may have moved, or you may not have access to it.")).to_be_visible()
        click(pg.get_by_role("link", name="Back to start", exact=True))
        expect(pg).to_have_url(app_url + "/")


def test_invite_and_signup_email(app_url, mail):
    tag = new_tag()
    email = f"new-{tag}@x.example"
    anon = Api(app_url)
    r = anon.post("/api/auth/sign-up", {"name": "Nia", "email": email, "password": PASSWORD})
    assert r.status_code == 201 and r.json() == {"message": "Check your email to confirm your account"}
    m = mails_to(mail, email)[0]
    assert m["Subject"] == "Confirm your Pinbyte Switchyard account"
    token = re.search(r"/confirm/([\w-]+)", mail_text(m)).group(1)
    assert anon.post("/api/auth/sign-in", {"email": email, "password": PASSWORD}).status_code == 403
    r = anon.post("/api/auth/confirm", {"token": token})
    assert r.status_code == 200 and r.json()["workspace_id"].startswith("ws-")
    assert anon.post("/api/auth/confirm", {"token": token}).status_code == 404
    w = make_world(app_url, roles=("owner",))
    inv = f"inv-{tag}@x.example"
    r = w.api().post(f"/api/workspaces/{w.id}/invites", {"email": inv, "role": "viewer"})
    assert r.status_code == 201
    m = mails_to(mail, inv)[0]
    assert m["Subject"] == f"{w.uname('owner')} invited you to Space {w.tag} on Pinbyte Switchyard"
    assert re.search(r"/invite/[\w-]+", mail_text(m))


def test_signup_and_invite_mail_outage(browser, app_url):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    email = f"down-{new_tag()}@x.example"
    anon = Api(base)
    r = anon.post("/api/auth/sign-up", {"name": "Nia", "email": email, "password": PASSWORD})
    assert r.status_code == 503 and r.json() == {"error": "Email is unavailable"}
    assert anon.post("/api/auth/sign-in", {"email": email, "password": PASSWORD}).status_code == 401
    with open_app(browser, base + "/sign-up") as pg:
        fill(pg.get_by_role("textbox", name="Name"), "Nia")
        fill(pg.get_by_role("textbox", name="Email"), email)
        fill(pg.get_by_role("textbox", name="Password"), PASSWORD)
        click(pg.get_by_role("button", name="Create account", exact=True))
        expect(pg.get_by_role("alert").filter(has_text="Email is unavailable. Your account was not created.")).to_be_visible()
    w = make_world(base, roles=("owner",))
    invitee = f"inv-{new_tag()}@x.example"
    r = w.api().post(f"/api/workspaces/{w.id}/invites", {"email": invitee, "role": "viewer"})
    assert r.status_code == 503 and r.json() == {"error": "Email is unavailable"}
    assert w.api().get(f"/api/workspaces/{w.id}/members").json()["invites"] == []
    with ui(browser, w, "owner", w.url("/members"), size=VIEW_DESKTOP) as pg:
        fill(pg.get_by_role("textbox", name="Invitee email"), invitee)
        click(pg.get_by_role("button", name="Send invite", exact=True))
        expect(pg.get_by_role("alert").filter(has_text="Email is unavailable. The invite was not sent.")).to_be_visible()


def test_landing_hero_and_example_tabs(browser, app_url):
    for mode in ("no-preference", "reduce"):
        with open_app(browser, app_url + "/", reduced_motion=mode) as pg:
            bar = pg.get_by_role("region", name="Release notice")
            expect(bar).to_contain_text("Runs stay on the version they started on.")
            expect(bar.get_by_role("link", name="Learn more", exact=True)).to_be_visible()
            nav = pg.get_by_role("navigation", name="Main")
            expect(nav.get_by_role("link", name="Sign in", exact=True)).to_be_visible()
            create = pg.get_by_role("link", name="Create a workspace", exact=True).first
            assert create.bounding_box()["height"] >= TOUCH_MIN - 0.5
            h1 = pg.get_by_role("heading", level=1, name=re.compile(r"Draft in peace\.\s*Publish with eyes open\."))
            expect(h1).to_be_visible()
            expect(pg.get_by_text("Wire forms, schedules, webhooks and tables into automations.")).to_be_visible()
            tabs = pg.get_by_role("tablist", name="Example automations")
            first = tabs.get_by_role("tab", name="Form to table row", exact=True)
            expect(first).to_have_attribute("aria-selected", "true")
            second = tabs.get_by_role("tab", name="Schedule to email", exact=True)

            def tabs_ready():
                first.focus()
                pg.keyboard.press("ArrowRight")
                pg.keyboard.press("Enter")
                advance(pg, 500)
                return second.get_attribute("aria-selected") == "true"
            poll(tabs_ready, "the preview tabs to become selectable")
            pg.keyboard.press("ArrowLeft")
            pg.keyboard.press("Enter")
            expect(first).to_have_attribute("aria-selected", "true")
            panels = lambda: pg.get_by_role("tabpanel").evaluate_all("els => els.map(e => e.innerHTML)")
            before = poll(lambda: (lambda p: p[0] if len(p) == 1 else None)(panels()), "one settled tabpanel before the switch")
            pg.keyboard.press("ArrowRight")
            pg.keyboard.press("Enter")
            expect(second).to_have_attribute("aria-selected", "true")
            poll(lambda: (lambda p: len(p) == 1 and p[0] != before)(panels()), "the second example to replace the first once the crossfade settles")
            pg.keyboard.press("ArrowRight")
            pg.keyboard.press("Enter")
            expect(tabs.get_by_role("tab", name="Webhook to loop", exact=True)).to_have_attribute("aria-selected", "true")
            if mode == "reduce":
                assert slow_animations(h1) == 0 and slow_animations(tabs) == 0


def test_workspace_pill_nav(browser, app_url):
    with open_app(browser, app_url + "/") as pg:
        pg.set_viewport_size({"width": VIEW_DESKTOP[0], "height": VIEW_DESKTOP[1]})
        pg.goto(app_url + "/")
        nav = pg.get_by_role("navigation", name="Main")
        logo = nav.get_by_role("link", name="Pinbyte Switchyard", exact=True)
        signin = nav.get_by_role("link", name="Sign in", exact=True)
        create = nav.get_by_role("link", name="Create a workspace", exact=True)
        expect(nav).to_be_visible()
        lb, sb, cb, nb = (x.bounding_box() for x in (logo, signin, create, nav))
        assert lb["x"] < sb["x"] < cb["x"]
        assert nb["y"] > 0 and nb["x"] > 0 and nb["x"] + nb["width"] < VIEW_DESKTOP[0]
        assert nb["height"] >= TOUCH_MIN - 0.5
        pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        assert pg.evaluate("window.scrollY") > 0
        expect(nav).to_be_in_viewport()
        assert 0 <= nav.bounding_box()["y"] <= nb["y"] + SAME_PX
        rest, hover = state_styles(signin, "color", "background-color", "text-decoration-color")
        assert rest != hover
    with open_app(browser, app_url + "/") as pg:
        pg.set_viewport_size({"width": VIEW_PHONE[0], "height": VIEW_PHONE[1]})
        pg.goto(app_url + "/")
        nav = pg.get_by_role("navigation", name="Main")
        menu = nav.get_by_role("button", name="Menu", exact=True)
        signin = nav.get_by_role("link", name="Sign in", exact=True)
        expect(menu).to_be_visible()
        expect(nav.get_by_role("link", name="Pinbyte Switchyard", exact=True)).to_be_visible()
        assert not shown(pg, signin)
        expect(menu).not_to_have_attribute("aria-expanded", "true")
        click(menu)
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(signin).to_be_visible()
        pg.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()
    w = make_world(app_url, roles=("owner",))
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        nav = pg.get_by_role("navigation", name="Main")
        for label in ("Automations", "Runs", "Tables", "Members"):
            expect(nav.get_by_role("link", name=label, exact=True)).to_be_visible()
        combo = nav.get_by_role("combobox", name="Workspace")
        expect(combo).to_contain_text(f"Space {w.tag}")
        select(combo, f"Space {w.tag}")
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}$"))
        click(nav.get_by_role("link", name="Tables", exact=True))
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/tables$"))
        click(nav.get_by_role("button", name="Sign out", exact=True))
        expect(pg).to_have_url(app_url + "/")


def test_landing_cards_stories_and_footer(browser, app_url):
    with open_app(browser, app_url + "/") as pg:
        cards = pg.get_by_role("region", name="Step kinds")
        for n in ("Triggers", "Logic and waiting", "Tables", "Mail and webhooks"):
            expect(cards.get_by_role("heading", level=3, name=n, exact=True)).to_be_visible()
        expect(pg.get_by_role("region", name="Automation stories").get_by_role("article")).to_have_count(3)
        expect(pg.get_by_role("contentinfo")).to_be_visible()
    w = make_world(app_url, roles=("owner",))
    with ui(browser, w, "owner", w.url()) as pg:
        expect(pg.get_by_role("contentinfo")).to_contain_text(f"Times are shown in {ZONE}")
        expect(pg.get_by_role("status", name="Run updates", exact=True)).to_be_attached()


def test_layouts_at_three_viewports(browser, app_url):
    w = phone_world(app_url)
    rid = w.rid("a", "r1")
    for size in (VIEW_PHONE, VIEW_TABLET, VIEW_DESKTOP):
        narrow = size[0] < BREAKPOINT
        with open_app(browser, app_url + "/") as pg:
            pg.set_viewport_size({"width": size[0], "height": size[1]})
            pg.goto(app_url + "/")
            layout(pg)
            expect(pg.get_by_role("button", name="Menu", exact=True)).to_have_count(1 if narrow else 0)
        for path in (w.url(), w.editor("a"), w.url("/runs"), w.url(f"/runs/{rid}"), w.url("/tables"), w.url("/members")):
            with ui(browser, w, "owner", path, size=size) as pg:
                layout(pg)
                if path == w.url("/runs"):
                    s, a = pg.get_by_role("combobox", name="Status").bounding_box(), pg.get_by_role("combobox", name="Automation").bounding_box()
                    assert (a["y"] >= s["y"] + s["height"] - 1) if narrow else abs(a["y"] - s["y"]) < 20
                if path == w.url(f"/runs/{rid}"):
                    sm, st = summary(pg).bounding_box(), step(pg, "Greeter").bounding_box()
                    assert (st["x"] > sm["x"] + sm["width"] / 2) if size == VIEW_DESKTOP else st["y"] >= sm["y"] + sm["height"] - 1
                if path == w.editor("a") and not narrow:
                    tb, cv = pg.get_by_role("toolbar", name="Step kinds").bounding_box(), pg.get_by_role("region", name="Automation canvas").bounding_box()
                    assert (tb["x"] + tb["width"] <= cv["x"] + 2) if size == VIEW_DESKTOP else tb["y"] + tb["height"] <= cv["y"] + 2


def test_health_for_primary_and_outage_instances(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    for env in ("APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        r = httpx.get(os.environ[env] + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}, env


def test_grading_routes(app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    for path in ("/api/grading/setup", f"/api/grading/workspaces/{w.id}/clock"):
        for headers in ({}, {"X-Grading-Key": "wrong-" + w.tag}):
            r = httpx.post(app_url + path, json={"advance_seconds": 1, "users": [], "workspaces": []}, headers=headers, timeout=HTTP_TIMEOUT)
            assert r.status_code == 404 and r.json() == {"error": "Not found"}
    cp = f"{app_url}/api/grading/workspaces/{w.id}/clock"
    for body in ({}, {"advance_seconds": 1, "set": "2030-01-01T00:00:00Z"}, {"set": "not-a-date"}):
        r = httpx.post(cp, json=body, headers=GK, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422 and r.json() == {"error": "Send advance_seconds or set"}, body
    assert httpx.post(f"{app_url}/api/grading/workspaces/ws-{hexid()}/clock", json={"advance_seconds": 1}, headers=GK, timeout=HTTP_TIMEOUT).status_code == 404
    dup = {"users": [{"key": "o", "email": w.email(), "name": "Dup", "password": PASSWORD}], "workspaces": []}
    r = httpx.post(app_url + "/api/grading/setup", json=dup, headers=GK, timeout=HTTP_TIMEOUT)
    assert r.status_code == 409 and r.json() == {"error": "Email already exists"}
    j = w.tick(WAIT_S // 2)
    assert isinstance(j["offset_seconds"], int) and j["offset_seconds"] >= WAIT_S // 2 and run_detail(w, rid)["status"] == "waiting"
    earlier = iso(parse(j["now"]) - timedelta(minutes=5))
    w.clock_set(earlier)
    assert run_detail(w, rid)["status"] == "waiting"
    w.tick(10 * 60)
    d = run_detail(w, rid)
    assert d["status"] == "succeeded" and by_id(d)["s1"]["log"].count(f"Attempt 1 of {ATTEMPTS} succeeded") == 1


def test_run_state_survives_restart(app_url):
    inst = Instance()
    try:
        inst.start()
        tag = new_tag()
        w = make_world(inst.url, [nap(seconds=120, runs=[R("r1")]),
                                  auto("h", "Hooked", "webhook", {"path": f"hk-{tag}"}, [S("s1", "set", "Echo", 2, {"values": {"got": tpl("trigger.order")}})],
                                       [E("trigger", "s1")])], tag=tag)
        first = hook(inst.url, w.slug, f"hk-{tag}", {"order": "1"}, key=f"k-{tag}").json()["run_id"]
        w.api().put(w.apath("a", "/draft/steps/s2"), {"name": "Edited"})
        rev = w.draft("a")["revision"]
        now1 = parse(w.tick(30)["now"])
        inst.stop()
        inst.start()
        resp = {"workspaces": {"w": {"id": w.id, "slug": w.slug, "automations": w.autos, "tables": w.tables}},
                "users": {k: {"cookie": v} for k, v in w.cookie.items()}}
        w2 = World(inst.url, tag, resp, list(w.user.values()))
        assert parse(w2.now()) >= now1
        assert w2.draft("a")["revision"] == rev and len(w2.api().get(w2.apath("a", "/versions")).json()["versions"]) == 1
        assert run_detail(w2, w2.rid("a", "r1"))["status"] == "waiting"
        r = hook(inst.url, w.slug, f"hk-{tag}", {"order": "1"}, key=f"k-{tag}")
        assert r.status_code == 200 and r.json() == {"run_id": first, "replayed": True}
        w2.tick(120)
        assert run_detail(w2, w2.rid("a", "r1"))["status"] == "succeeded"
    finally:
        inst.stop()


def test_if_run_manifest():
    m = json.loads((APP_ROOT / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    for font in ("Bricolage Grotesque", "Schibsted Grotesk", "JetBrains Mono"):
        assert font in notices


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_no_extra_datastore():
    banned = {"redis", "ioredis", "better-sqlite3", "sqlite3", "mongodb", "mongoose", "bullmq", "amqplib", "memcached", "nedb", "lowdb"}
    assert not [p.name for p in shipped_packages() if p.name in banned]
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        assert not [f for f in files if f.endswith((".sqlite", ".sqlite3", ".db", ".rdb"))], (root, files)
    procs = []
    for comm in Path("/proc").glob("[0-9]*/comm"):
        try:
            procs.append(comm.read_text())
        except OSError:
            pass
    procs = "".join(procs)
    assert not re.search(r"redis-server|memcached|mongod|rabbitmq|sqlite", procs)


def test_if_no_external_requests(browser, app_url):
    w = phone_world(app_url)
    urls = []
    with ui(browser, w, "owner", w.url(), size=VIEW_DESKTOP) as pg:
        pg.on("request", lambda r: urls.append(r.url))
        for path in ("/", w.url(), w.editor("a"), w.url("/runs"), w.url(f"/runs/{w.rid('a', 'r1')}"), w.url("/tables")):
            pg.goto(app_url + path)
            expect(pg.get_by_role("navigation", name="Main")).to_be_visible()
    foreign = [u for u in urls if not u.startswith(("data:", "blob:", "about:")) and not same_origin(u, app_url)]
    assert urls and not foreign, foreign


def test_if_credentials_not_in_browser_assets(app_url):
    secrets = [os.environ.get(k) for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "GRADING_KEY")]
    m = re.search(r"://[^:/]+:([^@]+)@", os.environ.get("DATABASE_URL", ""))
    secrets += [m.group(1)] if m else []
    secrets = [s for s in secrets if s and len(s) > 3]
    shell = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    blobs = [shell]
    for ref in set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', shell)):
        blobs.append(httpx.get(app_url + ref, timeout=HTTP_TIMEOUT).text)
    for s in secrets:
        assert not any(s in b for b in blobs)


def test_if_lockfile_install():
    assert any((APP_ROOT / f).exists() for f in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"))
    install = json.loads((APP_ROOT / "run.json").read_text())["install"]
    assert re.search(r"npm ci|--frozen-lockfile", install) and not re.search(r"curl|wget|git clone", install)


def test_if_no_forbidden_words(browser, app_url):
    w = phone_world(app_url)
    pattern = re.compile(r"\b(workflows?|flows?|zaps?)\b|\bAI\b", re.I)
    for path in ("/", w.url(), w.editor("a"), w.url("/runs"), w.url(f"/runs/{w.rid('a', 'r1')}"), w.url("/tables"), w.url("/members")):
        with ui(browser, w, "owner", path, size=VIEW_DESKTOP) as pg:
            expect(pg.get_by_role("navigation", name="Main")).to_be_visible()
            names = " ".join(n for role in ("heading", "button", "link", "tab", "columnheader")
                             for n in pg.get_by_role(role).evaluate_all("els => els.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim())"))
            hrefs = " ".join(pg.get_by_role("link").evaluate_all("els => els.map(e => e.getAttribute('href') || '')"))
            assert not pattern.search(names + " " + hrefs + " " + path), (path, pattern.search(names + " " + hrefs))


C_GREETER = "Greeter"
C_SHOWN = "Shown one"
GA_DIALOG_PRESSES = 12

GA_PUSH_EDGE_JS = """() => {
  window.__pedge = [];
  const note = el => window.__pedge.push({id: el.dataset.edgeId, anim: el.dataset.anim, at: document.timeline.currentTime});
  const scan = n => { if (n.nodeType !== 1) return; if (n.dataset && n.dataset.edgeId) note(n);
    n.querySelectorAll && n.querySelectorAll('[data-edge-id]').forEach(note); };
  new MutationObserver(ms => ms.forEach(m => { if (m.type === 'childList') m.addedNodes.forEach(scan);
    else if (m.target.dataset && m.target.dataset.edgeId) note(m.target); }))
    .observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-anim']});
}"""


def ga_focus_in(dlg):
    return dlg.evaluate("d => d.contains(document.activeElement)")


def test_wf_keyboard_build_edge_keys(browser, app_url):
    w = make_world(app_url, [auto("a", "Edge keys", "manual", {}, [S("s1", "set", "Alpha", 2, {"values": {"a": "1"}}),
                                                                S("s2", "set", "Beta", 3, {"values": {"b": "1"}})],
                                  [E("trigger", "s1"), E("s1", "s2")], live=False)])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        draft_notes = notes(pg, "Draft notices")
        alpha, beta = step(pg, "Alpha"), step(pg, "Beta")
        key(alpha, "c")
        expect(draft_notes).to_contain_text("Drawing an edge from Alpha (out). Choose a target and press Enter.")
        expect(alpha).to_be_focused()
        pg.keyboard.press("c")
        expect(draft_notes).to_contain_text("Drawing an edge from Alpha (error). Choose a target and press Enter.")
        expect(alpha).to_be_focused()
        pg.keyboard.press("Escape")
        expect(alpha).to_be_focused()
        assert len(w.draft("a")["edges"]) == 2
        pg.keyboard.press(".")
        edge = pg.get_by_role("button", name=edge_name("Alpha", "Beta"), exact=True)
        expect(edge).to_be_focused()
        pg.keyboard.press("Delete")
        expect(alpha).to_be_focused()
        expect(edge).to_have_count(0)
        poll(lambda: [(e["from"], e["to"]) for e in w.draft("a")["edges"]] == [("trigger", "s1")], "Delete on the edge to remove it")
        pg.keyboard.press("c")
        pg.keyboard.press("Tab")
        expect(beta).to_be_focused()
        pg.keyboard.press("Enter")
        expect(beta).to_be_focused()
        expect(pg.get_by_role("button", name=edge_name("Alpha", "Beta"), exact=True)).to_be_visible()
    poll(lambda: ("s1", "out", "s2") in [(e["from"], e["port"], e["to"]) for e in w.draft("a")["edges"]],
         "the keyboard-drawn edge from s1 out to s2")


def test_wf_drag_wiring_pushed_edge_draws_in(browser, app_url):
    w = make_world(app_url, [auto("a", "Pushed edge", "manual", {}, [S("s1", "set", "Mover", 4, {"values": {"a": "1"}}),
                                                                  S("s2", "set", "Settled", 4, {"values": {"b": "1"}}, row=4)],
                                  [E("trigger", "s2")], live=False)])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        old = pg.get_by_role("button", name=edge_name("Manual trigger", "Settled"), exact=True)
        expect(old).to_be_visible()
        assert old.get_attribute("data-anim") == "none"
        old_id = old.get_attribute("data-edge-id")
        pg.evaluate(GA_PUSH_EDGE_JS)
        r = w.api("editor").post(w.apath("a", "/draft/edges"), {"from": "trigger", "port": "out", "to": "s1"})
        assert r.status_code == 201, r.text
        new = pg.get_by_role("button", name=edge_name("Manual trigger", "Mover"), exact=True)
        expect(new).to_be_visible()
        expect(new).to_have_attribute("data-from", "trigger")
        expect(new).to_have_attribute("data-port", "out")
        expect(new).to_have_attribute("data-to", "s1")
        expect(new).to_have_attribute("data-anim", "none")
        new_id = new.get_attribute("data-edge-id")
        seen = pg.evaluate("window.__pedge")
    mine = [e for e in seen if e["id"] == new_id]
    run_at = next((e["at"] for e in mine if e["anim"] == "running"), None)
    assert run_at is not None, f"pushed edge never reported data-anim running: {mine}"
    end_at = next(e["at"] for e in mine if e["anim"] == "none" and e["at"] > run_at)
    assert EDGE_MIN_MS - MOTION_SLACK_MS <= end_at - run_at <= EDGE_MAX_MS + MOTION_SLACK_MS, mine
    assert not [e for e in seen if e["id"] == old_id and e["anim"] == "running"], seen


def ga_branch_auto(runs=()):
    return auto("a", "Branchy", "manual", {}, [
        S("s1", "branch", "Check amount", 2, {"left": tpl("trigger.amount"), "operator": "greater than", "right": "100"}),
        S("s2", "set", "High path", 3, {"values": {"l": "high"}}, row=1), S("s3", "set", "Low path", 3, {"values": {"l": "low"}}, row=3)],
        [E("trigger", "s1"), E("s1", "s2", "true"), E("s1", "s3", "false")], runs=runs, sample={"amount": 150})


def test_wf_branch_compare_step_log_keyboard(browser, app_url):
    w = make_world(app_url, [ga_branch_auto(runs=[R("r1", input={"amount": 150})])])
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")
        br = step(pg, "Check amount")
        key(br, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Check amount"))
        expect(dlg).to_be_visible()
        poll(lambda: ga_focus_in(dlg), "focus inside the step log dialog")
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("succeeded")
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(json.dumps({"result": True}, indent=2))
        expect(dlg.get_by_role("group", name="Attempts")).to_contain_text("Attempts: 1")
        for k in ("Tab", "Shift+Tab"):
            for _ in range(GA_DIALOG_PRESSES):
                pg.keyboard.press(k)
                assert ga_focus_in(dlg), k
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(br).to_be_focused()


def test_wf_branch_compare_case_sensitive_by_touch(browser, app_url):
    w = make_world(app_url, [auto("a", "Wordy", "manual", {}, [
        S("s1", "branch", "Match word", 2, {"left": tpl("trigger.word"), "operator": "equals", "right": "apple"}),
        S("s2", "set", "Same word", 3, {"values": {"m": "same"}}, row=1), S("s3", "set", "Other word", 3, {"values": {"m": "other"}}, row=3)],
        [E("trigger", "s1"), E("s1", "s2", "true"), E("s1", "s3", "false")], runs=[R("r1", input={"word": "Apple"})])])
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        expect(pg.get_by_role("list", name="Steps").get_by_role("listitem")).to_have_count(4)
        status = {sid: st for sid, _, st in list_rows(pg)}
        assert status["s1"] == "succeeded" and status["s2"] == "skipped" and status["s3"] == "succeeded", status
        tap(step(pg, "Match word"))
        dlg = pg.get_by_role("dialog", name=log_title("Match word"))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(json.dumps({"result": False}, indent=2))
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()
    assert by_id(run_detail(w, rid))["s1"]["output"] == {"result": False}


def test_wf_branch_compare_test_runs_announced(browser, app_url):
    w = make_world(app_url, [ga_branch_auto()])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        key(pg.get_by_role("button", name="Test run", exact=True), "Enter")
        expect(log).to_contain_text("Run #1 succeeded")
        expect(pg.get_by_role("link", name=view_run(1), exact=True)).to_be_visible()
        fill(pg.get_by_role("textbox", name="Run input (JSON)"), json.dumps({"amount": 50}))
        key(pg.get_by_role("button", name="Run now", exact=True), "Enter")
        expect(log).to_contain_text("Run #2 succeeded")
        expect(pg.get_by_role("link", name=view_run(2), exact=True)).to_be_visible()
        lines = [x.strip() for x in log.inner_text().splitlines() if x.strip()]
    order = ["Run #1 started", "Run #1 succeeded", "Run #2 started", "Run #2 succeeded"]
    for s in order:
        assert lines.count(s) == 1, (s, lines)
    assert [lines.index(s) for s in order] == sorted(lines.index(s) for s in order), lines
    runs = {r["number"]: r for r in w.runs(test="true")}
    assert runs[1]["test"] is True and runs[2]["test"] is False and runs[2]["version"] == 1


def ga_list_loop(runs=()):
    return auto("a", "Vars", "manual", {}, [
        S("s1", "loop", "Each", 2, {"source": "list", "list": tpl("trigger.items")}),
        S("s2", "set", "Body", 3, {"values": {"label": "Row " + tpl("loop.index") + ": " + tpl("loop.item.name")}})],
        [E("trigger", "s1"), E("s1", "s2", "each")], runs=runs)


def test_wf_loop_rows_body_log_by_touch(browser, app_url):
    w = make_world(app_url, [ga_list_loop(runs=[R("r1", input={"items": [{"name": "Pen"}, {"name": "Ink"}]})])])
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        expect(pg.get_by_role("list", name="Steps")).to_be_visible()
        tap(step(pg, "Body"))
        dlg = pg.get_by_role("dialog", name=log_title("Body"))
        expect(dlg).to_be_visible()
        line = re.compile(rf"^\s*Attempt 1 of {ATTEMPTS} succeeded\s*$")
        expect(dlg.get_by_role("list", name="Log").get_by_role("listitem").filter(has_text=line)).to_have_count(2)
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(json.dumps({"label": "Row 2: Ink"}, indent=2))
        expect(dlg.get_by_role("group", name="Attempts")).to_contain_text("Attempts: 1")
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_loop_rows_table_updates_announced(browser, app_url):
    src, dst = loop_tables()
    w = make_world(app_url, [auto("a", "Loopy", "manual", {}, [
        S("s1", "loop", "Each row", 2, {"source": "table", "table": src["id"]}),
        S("s2", "add_row", "Add follow-up", 3, {"table": dst["id"], "values": {"customer": tpl("loop.item.customer"),
                                                                              "position": tpl("loop.index")}})],
        [E("trigger", "s1"), E("s1", "s2", "each")])], tables=[src, dst])
    with ui(browser, w, "owner", w.url(f"/tables/{w.tid('dst')}"), size=VIEW_DESKTOP) as pg:
        grid = pg.get_by_role("table", name="Followups", exact=True)
        expect(grid.get_by_role("columnheader", name="Row id")).to_be_visible()
        assert grid.get_by_role("row").evaluate_all("els => els.filter(e => e.dataset.rowId).length") == 0
        w.start("a")
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 started")
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 succeeded")
        expect(grid.get_by_role("columnheader", name="Row id")).to_be_visible()
        ids = poll(lambda: (v := grid.get_by_role("row").evaluate_all(
            "els => els.map(e => e.dataset.rowId).filter(Boolean)")) == ["r1", "r2", "r3"] and v,
                   "rows r1 to r3 to appear in place")
        assert ids == ["r1", "r2", "r3"], ids
    rows = w.api().get(f"/api/workspaces/{w.id}/tables/{w.tid('dst')}").json()["rows"]
    assert [r["_row_id"] for r in rows] == ["r1", "r2", "r3"] and [r["position"] for r in rows] == [1, 2, 3]


def test_wf_loop_rows_bad_source_announced(browser, app_url):
    w = make_world(app_url, [auto("l", "Bad source", "manual", {}, [S("s1", "loop", "Bad loop", 2, {"source": "list", "list": "not a list"})],
                                  [E("trigger", "s1")])])
    msg = "Loop source is not a list"
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        rid, _ = w.start("l")
        w.settle_retries()
        expect(notes(pg, "Run updates")).to_contain_text(failed_at(1, "Bad loop"))
        expect(run_item(pg, 1, "Bad source")).to_have_attribute("data-status", "failed")
        pg.goto(app_url + w.url(f"/runs/{rid}"))
        expect(summary(pg)).to_contain_text(f"Step s1 failed after {ATTEMPTS} attempts: {msg}")
        lp = step(pg, "Bad loop")
        expect(lp).to_have_attribute("data-status", "failed")
        key(lp, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Bad loop"))
        expect(dlg.get_by_role("list", name="Log")).to_contain_text(f"Attempt {ATTEMPTS} of {ATTEMPTS} failed: {msg}")
        pg.keyboard.press("Escape")
        expect(lp).to_be_focused()


def test_wf_loop_rows_depth_first_step_list(browser, app_url):
    steps = [S("s1", "set", "One", 2, {"values": {"a": "1"}}),
             S("s2", "loop", "Loop", 3, {"source": "list", "list": tpl("trigger.items")}),
             S("s3", "set", "Row", 4, {"values": {"n": tpl("loop.index")}}, row=1),
             S("s4", "set", "Two", 4, {"values": {"a": "2"}}, row=3),
             S("s5", "set", "Five", 3, {"values": {"a": "5"}}, row=4),
             S("s6", "set", "Six", 5, {"values": {"a": "6"}})]
    edges = [E("trigger", "s1"), E("s1", "s5", "out", 2), E("s1", "s2", "out", 1), E("s2", "s4", "each", 2),
             E("s2", "s3", "each", 1), E("s2", "s6", "done", 1)]
    w = make_world(app_url, [auto("a", "Order", "manual", {}, steps, edges, runs=[R("r1", input={"items": [{"n": 1}, {"n": 2}]})])])
    rid = w.rid("a", "r1")
    order = ["trigger", "s1", "s2", "s3", "s4", "s6", "s5"]
    names = ["Manual trigger", "One", "Loop", "Row", "Two", "Six", "Five"]
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        expect(pg.get_by_role("list", name="Steps").get_by_role("listitem")).to_have_count(len(order))
        assert [sid for sid, _, _ in list_rows(pg)] == order
        step(pg, names[0]).focus()
        for n in names[1:]:
            pg.keyboard.press("ArrowDown")
            expect(step(pg, n)).to_be_focused()
    assert [s["id"] for s in run_detail(w, rid)["steps"]] == order


def test_wf_wait_cancel_space_cancel_seen_live(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    with ui(browser, w, "editor", w.url("/runs"), size=VIEW_DESKTOP) as watcher:
        item = run_item(watcher, 1, "Napper")
        expect(item).to_have_attribute("data-status", "waiting")
        with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
            key(pg.get_by_role("button", name="Cancel run", exact=True), "Space")
            expect(summary(pg)).to_have_attribute("data-status", "cancelled")
            expect(item).to_have_attribute("data-status", "cancelled")
            expect(notes(watcher, "Run updates")).to_contain_text("Run #1 was cancelled")
            key(step(pg, "Sleeper"), "Enter")
            dlg = pg.get_by_role("dialog", name=log_title("Sleeper"))
            expect(dlg.get_by_role("group", name="Status")).to_contain_text("cancelled")
            pg.keyboard.press("Escape")
            expect(step(pg, "Sleeper")).to_be_focused()
        w.tick(WAIT_S * 2)
        expect(item).to_have_attribute("data-status", "cancelled")
        assert "Run #1 succeeded" not in notes(watcher, "Run updates").inner_text()
    d = run_detail(w, rid)
    assert d["status"] == "cancelled" and by_id(d)["s1"]["status"] == "cancelled" and by_id(d)["s2"]["status"] == "skipped"


def test_wf_wait_cancel_tab_clock_behind(browser, app_url):
    w = make_world(app_url, [nap(runs=[R("r1")])])
    rid = w.rid("a", "r1")
    due = by_id(run_detail(w, rid))["s1"]["due_at"]
    behind = iso(parse(w.now()) - timedelta(hours=BROWSER_SKEW_H))
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP, before=lambda p: p.clock.set_fixed_time(behind)) as pg:
        sleeper = step(pg, "Sleeper")
        expect(sleeper).to_have_attribute("data-status", "waiting")
        key(sleeper, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Sleeper"))
        expect(dlg).to_be_visible()
        poll(lambda: ga_focus_in(dlg), "focus inside the step log dialog")
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("waiting")
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Due: " + fmt(due))
        pg.keyboard.press("Escape")
        expect(sleeper).to_be_focused()
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(notes(pg, "Run updates")).to_contain_text("Run #1 succeeded")
        expect(summary(pg)).to_have_attribute("data-status", "succeeded")
        expect(sleeper).to_have_attribute("data-status", "succeeded")
        finished = by_id(run_detail(w, rid))["s1"]["finished_at"]
        key(sleeper, "Enter")
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Finished: " + fmt(finished))


B_INTERVAL_S = 10 * 60


def b_lines(loc):
    return [x.strip() for x in loc.inner_text().splitlines() if x.strip()]


def test_wf_retry_error_path_retry_log_keyboard(browser, app_url):
    tag = new_tag()
    w = make_world(app_url, [failing(tag, runs=[R("r1")])], tag=tag)
    rid = w.rid("a", "r1")
    s1 = by_id(run_detail(w, rid))["s1"]
    assert s1["status"] == "retrying" and s1["retry_at"]
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        hook_step = step(pg, "Hook call")
        expect(hook_step).to_have_attribute("data-status", "retrying")
        expect(summary(pg)).to_have_attribute("data-status", "running")
        key(hook_step, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Hook call"))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("retrying")
        expect(dlg.get_by_role("list", name="Log").get_by_role("listitem")).to_have_text(
            [f"Attempt 1 of {ATTEMPTS} failed: Webhook answered 404"])
        expect(dlg.get_by_role("group", name="Attempts")).to_contain_text("Attempts: 1")
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Retry at: " + fmt(s1["retry_at"]))
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(hook_step).to_be_focused()


def test_wf_retry_error_path_error_edge_announced(browser, app_url):
    tag = new_tag()
    handler = S("s2", "set", "Handler", 3, {"values": {"h": "1"}})
    w = make_world(app_url, [failing(tag, name="Caught", error_to="s2", extra=[handler])], tag=tag)
    with ui(browser, w, "editor", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        rid, n = w.start("a")
        expect(log).to_contain_text(f"Run #{n} started")
        item = run_item(pg, n, "Caught")
        expect(item).to_have_attribute("data-status", "running")
        w.settle_retries()
        expect(item).to_have_attribute("data-status", "succeeded")
        expect(log).to_contain_text(f"Run #{n} succeeded")
        lines = b_lines(log)
        assert lines.count(f"Run #{n} started") == 1 and lines.count(f"Run #{n} succeeded") == 1, lines
        assert failed_at(n, "Hook call") not in lines and not [x for x in lines if "retry" in x.lower()], lines
    st = by_id(run_detail(w, rid))
    assert st["s1"]["status"] == "failed" and st["s2"]["status"] == "succeeded"


def test_wf_retry_error_path_phone_failure_touch(browser, app_url):
    tag = new_tag()
    nxt = S("s2", "set", "Never", 3, {"values": {"a": "1"}})
    w = make_world(app_url, [failing(tag, name="Dropped", extra=[nxt], edges_extra=[E("s1", "s2")], runs=[R("r1")])], tag=tag)
    rid = w.rid("a", "r1")
    w.settle_retries()
    msg = f"Step s1 failed after {ATTEMPTS} attempts: Webhook answered 404"
    assert run_detail(w, rid)["status"] == "failed"
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        expect(summary(pg)).to_have_attribute("data-status", "failed")
        expect(summary(pg)).to_contain_text(msg)
        expect(pg.get_by_role("list", name="Steps").get_by_role("listitem")).to_have_count(3)
        assert list_rows(pg) == [["trigger", "manual", "succeeded"], ["s1", "call_webhook", "failed"], ["s2", "set", "skipped"]]
        tap(step(pg, "Hook call"))
        dlg = pg.get_by_role("dialog", name=log_title("Hook call"))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("failed")
        expect(dlg.get_by_role("group", name="Attempts")).to_contain_text(f"Attempts: {ATTEMPTS}")
        expect(dlg.get_by_role("list", name="Log").get_by_role("listitem")).to_have_text(
            [f"Attempt {k} of {ATTEMPTS} failed: Webhook answered 404" for k in range(1, ATTEMPTS + 1)])
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_retry_error_path_mail_outage_announced(browser, app_url):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    tag = new_tag()
    w = make_world(base, [auto("n", "Mail down", "manual", {}, [
        S("s1", "send_email", "Mail out", 2, {"to": addr(tag), "subject": "down-" + tag, "body": "b"})], [E("trigger", "s1")])], tag=tag)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        rid, n = w.start("n")
        expect(log).to_contain_text(f"Run #{n} started")
        item = run_item(pg, n, "Mail down")
        expect(item).to_have_attribute("data-status", "running")
        w.settle_retries()
        expect(item).to_have_attribute("data-status", "failed")
        expect(log).to_contain_text(failed_at(n, "Mail out"))
        lines = b_lines(log)
        assert lines.count(failed_at(n, "Mail out")) == 1 and f"Run #{n} succeeded" not in lines, lines
        key(pg.get_by_role("link", name=run_title(n, "Mail down"), exact=True), "Enter")
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{rid}$"))
        expect(step(pg, "Mail out")).to_have_attribute("data-status", "failed")
        expect(summary(pg)).to_contain_text(f"Step s1 failed after {ATTEMPTS} attempts: Mail server did not accept the message")


def test_wf_export_import_export_pending_keyboard(browser, app_url):
    w = export_world(app_url)
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        held_routes = []

        def hold(route):
            held_routes.append(route)
        pg.route("**/versions/1/export", hold)
        btn = pg.get_by_role("button", name="Export live version", exact=True)
        expect(btn).to_be_enabled()
        handle = btn.element_handle()
        key(btn, "Enter")
        box = notes(pg, "Notices")
        expect(box).to_contain_text("Saving export...")
        poll(lambda: handle.get_attribute("aria-busy") == "true" and handle.is_disabled() and "Working..." in (handle.text_content() or ""),
             "the export button to be disabled, aria-busy and read Working... while the request is in flight")
        expect(box).not_to_contain_text("Export saved")
        assert held_routes, "the export request never left the page"
        pg.unroute("**/versions/1/export", hold)
        with pg.expect_download() as dl:
            while held_routes:
                held_routes.pop(0).fallback()
        expect(box).to_contain_text("Export saved")
        raw = Path(dl.value.path()).read_bytes()
        expect(pg.get_by_role("button", name="Export live version", exact=True)).to_be_enabled()
    assert S3().get(f"exports/{w.id}/{w.aid('a')}/v1.json") == raw


def test_wf_export_import_import_refused_notice(browser, app_url, tmp_path):
    w = export_world(app_url)
    doc = json.loads(valid_file(w))
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({**doc, "steps": [{**doc["steps"][0], "kind": "teleport"}]}))
    other = tmp_path / "other.json"
    other.write_text(json.dumps({"format": "other", "format_version": 1}))
    with ui(browser, w, "owner", w.url(), size=VIEW_DESKTOP) as pg:
        for f, msg in ((bad, "Unknown node kind: teleport"), (other, "Import is not a Switchyard automation")):
            pg.goto(w.base + w.url())
            key(pg.get_by_role("button", name="Import automation", exact=True), "Enter")
            pg.get_by_label("Automation file").set_input_files(str(f))
            expect(notes(pg, "Notices")).to_contain_text(msg)
            expect(pg).to_have_url(re.compile(rf"/w/{w.id}$"))
            expect(pg.get_by_role("list", name="Automations").get_by_role("listitem")).to_have_count(1)
    assert not S3().keys(f"imports/{w.id}/")
    assert len(w.api().get(f"/api/workspaces/{w.id}/automations").json()["automations"]) == 1


def test_wf_export_import_imported_draft_keyboard(browser, app_url, tmp_path):
    w = export_world(app_url)
    f = tmp_path / "in.json"
    f.write_bytes(valid_file(w))
    with ui(browser, w, "owner", w.url(), size=VIEW_DESKTOP) as pg:
        key(pg.get_by_role("button", name="Import automation", exact=True), "Enter")
        pg.get_by_label("Automation file").set_input_files(str(f))
        landed = re.compile(rf"/w/{w.id}/automations/(au-[0-9a-f]{{8}})(?:[?#].*)?$")
        expect(pg).to_have_url(landed)
        assert landed.search(pg.url).group(1) != w.aid("a")
        expect(pg.get_by_role("group", name="Version drain")).to_contain_text("No version")
        expect(pg.get_by_role("button", name="Export live version", exact=True)).to_be_disabled()
        pg.get_by_role("group", name="Grid cursor").focus()
        pg.keyboard.press("Tab")
        expect(step(pg, "Form trigger")).to_be_focused()
        pg.keyboard.press("Tab")
        setter = step(pg, "Setter")
        expect(setter).to_be_focused()
        expect(setter).to_have_attribute("data-step-id", "s1")
        expect(setter).to_have_attribute("data-col", "2")
        expect(setter).to_have_attribute("data-row", "2")
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name=settings_title("Setter"))
        expect(dlg.get_by_role("textbox", name="Step name", exact=True)).to_be_focused()
        pg.keyboard.press("Escape")
        expect(setter).to_be_focused()


def test_wf_export_import_outage_dismiss_keyboard(browser, app_url):
    base = os.environ["APP_MINIO_DOWN_URL"]
    w = export_world(app_url, base)
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        downloads = []
        pg.on("download", lambda d: downloads.append(d))
        btn = pg.get_by_role("button", name="Export live version", exact=True)
        key(btn, "Enter")
        alert = pg.get_by_role("alert").filter(has_text="Storage is unavailable. Nothing was saved.")
        expect(alert).to_be_visible()
        expect(notes(pg, "Notices")).not_to_contain_text("Export saved")
        key(alert.get_by_role("button", name="Dismiss", exact=True), "Enter")
        expect(alert).to_be_hidden()
        expect(btn).to_be_enabled()
        assert not downloads
    assert not S3().keys(f"exports/{w.id}/")


def test_wf_webhook_intake_refusals_add_no_row(browser, app_url):
    w = hook_world(app_url)
    path = f"hk0-{w.tag}"
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        results = notes(pg, "Run list results")
        expect(results).to_contain_text("Runs shown: 0")
        got = [hook(app_url, w.slug, f"nope-{w.tag}", {"order": "x"}).status_code,
               hook(app_url, w.slug, path, {"order": "x"}, method="PUT").status_code,
               hook(app_url, w.slug, path, b"x" * (HOOK_LIMIT + 1)).status_code,
               hook(app_url, w.slug, path, b'{"order":"x"}', ctype="text/plain").status_code,
               hook(app_url, w.slug, path, b"{bad").status_code]
        assert got == [404, 405, 413, 415, 422], got
        assert hook(app_url, w.slug, path, {"order": "B1"}).status_code == 202
        expect(run_item(pg, 1, "Intake hook 0")).to_be_visible()
        expect(results).to_contain_text("Runs shown: 1")
        expect(pg.get_by_role("list", name="Runs").get_by_role("listitem")).to_have_count(1)
        lines = b_lines(notes(pg, "Run updates"))
        assert lines.count("Run #1 started") == 1 and not [x for x in lines if x.startswith("Run #2")], lines


def test_wf_webhook_intake_conflict_keeps_original_keyboard(browser, app_url):
    w = hook_world(app_url)
    path, k = f"hk0-{w.tag}", f"key-{w.tag}"
    first = hook(app_url, w.slug, path, b'{"order":"A1"}', key=k)
    assert first.status_code == 202
    r = hook(app_url, w.slug, path, b'{"order":"Z9"}', key=k)
    assert r.status_code == 409 and r.json() == {"error": "Idempotency-Key was already used with a different body"}
    rid = first.json()["run_id"]
    wait_run(w, rid, "succeeded")
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        expect(pg.get_by_role("list", name="Runs").get_by_role("listitem")).to_have_count(1)
        key(pg.get_by_role("link", name=run_title(1, "Intake hook 0"), exact=True), "Enter")
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{rid}$"))
        trig = step(pg, "Webhook trigger")
        key(trig, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Webhook trigger"))
        out = dlg.get_by_role("group", name="Output")
        expect(out).to_contain_text(json.dumps({"order": "A1"}, indent=2))
        expect(out).not_to_contain_text("Z9")
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(trig).to_be_focused()


def test_wf_webhook_intake_window_lapse_live(browser, app_url):
    w = hook_world(app_url)
    path, k = f"hk0-{w.tag}", f"key-{w.tag}"
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        first = hook(app_url, w.slug, path, {"order": "1"}, key=k)
        assert first.status_code == 202
        expect(run_item(pg, 1, "Intake hook 0")).to_be_visible()
        w.tick(IDEM_WINDOW // 2)
        assert hook(app_url, w.slug, path, {"order": "1"}, key=k).json() == {"run_id": first.json()["run_id"], "replayed": True}
        w.tick(IDEM_WINDOW // 2 + CLOCK_SLACK_S * 2)
        later = hook(app_url, w.slug, path, {"order": "1"}, key=k)
        assert later.status_code == 202 and later.json()["replayed"] is False
        expect(run_item(pg, 2, "Intake hook 0")).to_be_visible()
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 2")
        expect(log).to_contain_text("Run #2 started")
        lines = b_lines(log)
        assert lines.count("Run #1 started") == 1 and lines.count("Run #2 started") == 1, lines
        assert not [x for x in lines if x.startswith("Run #3")], lines


def test_wf_webhook_intake_limit_body_phone_touch(browser, app_url):
    w = hook_world(app_url)
    path = f"hk0-{w.tag}"
    filler = "a" * (HOOK_LIMIT - 8)
    exact = b'{"p":"' + filler.encode() + b'"}'
    assert len(exact) == HOOK_LIMIT
    ok = hook(app_url, w.slug, path, exact)
    assert ok.status_code == 202
    assert hook(app_url, w.slug, path, exact[:-2] + b'a"}').status_code == 413
    rid = ok.json()["run_id"]
    wait_run(w, rid, "succeeded")
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_PHONE) as pg:
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 1")
        tap(pg.get_by_role("link", name=run_title(1, "Intake hook 0"), exact=True))
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{rid}$"))
        expect(pg.get_by_role("list", name="Steps").get_by_role("listitem")).to_have_count(2)
        tap(step(pg, "Webhook trigger"))
        dlg = pg.get_by_role("dialog", name=log_title("Webhook trigger"))
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("succeeded")
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(json.dumps({"p": filler}, indent=2))
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_schedule_dst_spring_forward_announced(browser, app_url):
    w = sched_world(app_url, "daily at 02:30", "2027-03-13T05:00:00Z", "Spring")
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log, results = notes(pg, "Run updates"), notes(pg, "Run list results")
        expect(results).to_contain_text("Runs shown: 0")
        w.clock_set("2027-03-14T08:00:00Z")
        expect(run_item(pg, 2, "Spring")).to_be_visible()
        expect(results).to_contain_text("Runs shown: 2")
        expect(log).to_contain_text("Run #2 succeeded")
        lines = b_lines(log)
        for n in (1, 2):
            assert lines.count(f"Run #{n} started") == 1 and lines.count(f"Run #{n} succeeded") == 1, lines
        assert not [x for x in lines if x.startswith("Run #3")], lines
        for r in w.runs(automation=w.aid("a")):
            expect(run_item(pg, r["number"], "Spring")).to_contain_text("Started " + fmt(r["started_at"]))
    assert fired(w) == [utc(2027, 3, 13, 7, 30), utc(2027, 3, 14, 7, 0)]


def test_wf_schedule_dst_fall_back_log_keyboard(browser, app_url):
    w = sched_world(app_url, "daily at 01:30", "2027-11-06T20:00:00Z", "Fallback")
    w.clock_set("2027-11-07T12:00:00Z")
    runs = w.runs(automation=w.aid("a"))
    assert len(runs) == 1
    d = run_detail(w, runs[0]["id"])
    assert parse(d["trigger"]["fired_at"]) == utc(2027, 11, 7, 5, 30)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        expect(pg.get_by_role("list", name="Runs").get_by_role("listitem")).to_have_count(1)
        key(pg.get_by_role("link", name=run_title(1, "Fallback"), exact=True), "Enter")
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{d['id']}$"))
        trig = step(pg, "Schedule trigger")
        key(trig, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Schedule trigger"))
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(d["trigger"]["fired_at"])
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Started: " + fmt(d["started_at"]))
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(trig).to_be_focused()


def test_wf_schedule_dst_interval_live_announced(browser, app_url):
    w = sched_world(app_url, "every 10 minutes", "2027-03-13T12:00:00Z", "Ticker")
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        log = notes(pg, "Run updates")
        w.tick(B_INTERVAL_S + CLOCK_SLACK_S)
        expect(run_item(pg, 1, "Ticker")).to_have_attribute("data-status", "succeeded")
        expect(log).to_contain_text("Run #1 started")
        w.tick(B_INTERVAL_S)
        item = run_item(pg, 2, "Ticker")
        expect(item).to_have_attribute("data-status", "succeeded")
        expect(item).to_contain_text("Version 1")
        expect(notes(pg, "Run list results")).to_contain_text("Runs shown: 2")
        expect(log).to_contain_text("Run #2 started")
        lines = b_lines(log)
        assert lines.count("Run #1 started") == 1 and lines.count("Run #2 started") == 1, lines
        assert not [x for x in lines if x.startswith("Run #3")], lines


def test_wf_schedule_dst_phone_log_touch(browser, app_url):
    w = sched_world(app_url, "daily at 02:30", "2027-03-13T05:00:00Z", "Phone sched")
    w.clock_set("2027-03-14T08:00:00Z")
    runs = {r["number"]: r for r in w.runs(automation=w.aid("a"))}
    assert sorted(runs) == [1, 2]
    d = run_detail(w, runs[2]["id"])
    assert parse(d["trigger"]["fired_at"]) == utc(2027, 3, 14, 7, 0)
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_PHONE) as pg:
        tap(pg.get_by_role("link", name=run_title(2, "Phone sched"), exact=True))
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{d['id']}$"))
        expect(summary(pg)).to_contain_text("Started " + fmt(d["started_at"]))
        expect(summary(pg)).to_contain_text("Finished " + fmt(d["finished_at"]))
        expect(pg.get_by_role("list", name="Steps").get_by_role("listitem")).to_have_count(2)
        tap(step(pg, "Schedule trigger"))
        dlg = pg.get_by_role("dialog", name=log_title("Schedule trigger"))
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(d["trigger"]["fired_at"])
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Started: " + fmt(d["started_at"]))
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()
        layout(pg)


def test_wf_version_pinning_publish_keyboard(browser, app_url):
    draft = content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}),
                                   S("s2", "set", "After keyed", 3, {"values": {"x": "1"}})], [E("trigger", "s1"), E("s1", "s2")])
    w = make_world(app_url, [nap(runs=[R("r1")], draft=draft)])
    r1 = w.rid("a", "r1")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        grp, log = pg.get_by_role("group", name="Version drain"), notes(pg, "Run updates")
        expect(grp).to_have_attribute("data-live-version", "1")
        pub = pg.get_by_role("button", name="Publish", exact=True)
        key(pub, "Enter")
        expect(grp).to_have_attribute("data-live-version", "2")
        expect(grp).to_have_attribute("data-drain-count", "1")
        expect(log).to_contain_text(published(2))
        fill(pg.get_by_role("textbox", name="Run input (JSON)", exact=True), "{}")
        key(pg.get_by_role("button", name="Run now", exact=True), "Enter")
        expect(pg.get_by_role("link", name=view_run(2), exact=True)).to_be_visible()
        expect(log).to_contain_text(waiting_at(2, "Sleeper"))
        expect(grp).to_have_attribute("data-drain-count", "1")
    vs = {v["version"]: v["status"] for v in w.api().get(w.apath("a", "/versions")).json()["versions"]}
    assert vs == {1: "draining", 2: "live"}
    runs = {r["number"]: r for r in w.runs(automation=w.aid("a"))}
    assert runs[2]["version"] == 2 and runs[1]["id"] == r1
    d = run_detail(w, r1)
    assert d["version"] == 1 and d["status"] == "waiting"


def test_wf_version_pinning_ghosts_reduced_motion(browser, app_url):
    v1 = content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}), S("s2", "set", "After", 3, {"values": {"x": "1"}})],
                 [E("trigger", "s1"), E("s1", "s2")])
    v2 = content("manual", {}, [S("s1", "wait", "Sleeper", 2, {"seconds": WAIT_S}), S("s2", "set", "After two", 3, {"values": {"x": "2"}})],
                 [E("trigger", "s1"), E("s1", "s2")])
    w = make_world(app_url, [auto("a", "Still ghosts", versions=[v1, v2], runs=[R("old", 1)])])
    old = w.rid("a", "old")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP, reduced_motion="reduce") as pg:
        grp, log = pg.get_by_role("group", name="Version drain"), notes(pg, "Run updates")
        expect(grp).to_have_attribute("data-drain-count", "1")
        expect(grp).to_contain_text(numeral(2))
        token = pg.locator(f'[data-run-token="{old}"]')
        expect(token).to_have_attribute("data-version", "1")
        expect(token).to_have_attribute("data-at-step", "s1")
        ghosts = pg.locator('[data-ghost="true"]')
        poll(lambda: ghosts.count() > 0, "ghost edges of version 1 under reduced motion")
        assert {tuple(x) for x in ghosts.evaluate_all("els => els.map(e => [e.dataset.version, e.dataset.anim])")} == {("1", "none")}
        assert set(pg.locator("[data-edge-id]").evaluate_all("els => els.map(e => e.dataset.anim)")) == {"none"}
        assert slow_animations(grp) == 0
        r = w.api().post(f"/api/workspaces/{w.id}/runs/{old}/cancel")
        assert r.status_code == 200
        expect(grp).to_have_attribute("data-drain-count", "0")
        expect(grp).to_contain_text(left_on_older(0))
        expect(log).to_contain_text(left_on_older(0))
        expect(token).to_have_count(0)
        expect(ghosts).to_have_count(0)
        assert slow_animations(grp) == 0


C_NAME_BY_EDITOR = "Pause by editor"
C_NAME_BY_OWNER = "Pause by owner"
C_PHONE_WAIT_S = 30
C_SHORT_PW = "short1"
C_HIDDEN = "Hidden napper"
C_NOT_FOUND = "We couldn't find that page"
C_NOT_FOUND_LINE = "It may have moved, or you may not have access to it."
C_VIEWER_REASON = "Viewers cannot change this workspace"
C_DRAFT_SAVED = "Draft saved. Not live until you publish."


def test_wf_co_editing_keyboard_rename_conflict(browser, app_url):
    w = coedit_world(app_url)
    me, other = w.uname("owner"), w.uname("editor")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as a, ui(browser, w, "editor", w.editor("a"), size=VIEW_DESKTOP) as b:
        expect(notes(b, "Draft notices")).to_contain_text(f"{me} is also editing this draft")
        nb = open_settings(b, "Pause").get_by_role("textbox", name="Step name")
        expect(nb).to_be_focused()
        nb.fill(C_NAME_BY_EDITOR)
        nb.press("Enter")
        expect(step(a, C_NAME_BY_EDITOR)).to_be_visible()
        na = open_settings(a, C_NAME_BY_EDITOR).get_by_role("textbox", name="Step name")
        expect(na).to_be_focused()
        na.fill(C_NAME_BY_OWNER)
        na.press("Enter")
        expect(notes(a, "Draft notices")).to_contain_text(f"{other} is editing {C_NAME_BY_EDITOR}. Your change was not saved.")
        expect(na).to_have_value(C_NAME_BY_EDITOR)
        a.keyboard.press("Escape")
        expect(step(a, C_NAME_BY_EDITOR)).to_be_focused()
    assert w.draft("a")["steps"][0]["name"] == C_NAME_BY_EDITOR


def test_wf_co_editing_own_hold_by_keyboard(browser, app_url):
    w = coedit_world(app_url)
    other = w.uname("editor")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as a, ui(browser, w, "editor", w.editor("a"), size=VIEW_DESKTOP) as b:
        expect(notes(a, "Draft notices")).to_contain_text(f"{other} is also editing this draft")
        fa = open_settings(a, "Pause").get_by_role("spinbutton", name="Seconds")
        fb = open_settings(b, "Pause").get_by_role("spinbutton", name="Seconds")
        for secs in ("7", "8"):
            fb.fill(secs)
            fb.press("Enter")
            expect(fa).to_have_value(secs)
        expect(notes(b, "Draft notices")).to_contain_text(C_DRAFT_SAVED)
        expect(notes(b, "Draft notices")).not_to_contain_text("Your change was not saved.")
    assert w.draft("a")["steps"][0]["fields"]["seconds"] == 8
    r = w.api().put(w.apath("a", "/draft/steps/s1"), {"fields": {"seconds": 9}})
    assert r.status_code == 409 and r.json()["error"] == f"{other} is editing Pause. Your change was not saved."


def test_wf_co_editing_keyboard_move_needs_no_hold(browser, app_url):
    w = coedit_world(app_url)
    other = w.uname("editor")
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as a, ui(browser, w, "editor", w.editor("a"), size=VIEW_DESKTOP) as b:
        expect(notes(a, "Draft notices")).to_contain_text(f"{other} is also editing this draft")
        fb = open_settings(b, "Pause").get_by_role("spinbutton", name="Seconds")
        fb.fill("7")
        fb.press("Enter")
        expect(notes(b, "Draft notices")).to_contain_text(C_DRAFT_SAVED)
        b.keyboard.press("Escape")
        expect(step(b, "Pause")).to_be_focused()
        pa = step(a, "Pause")
        row = int(pa.get_attribute("data-row"))
        key(pa, "ArrowDown")
        expect(pa).to_have_attribute("data-row", str(row + 1))
        expect(pa).to_be_focused()
        expect(notes(a, "Draft notices")).not_to_contain_text("Your change was not saved.")
        expect(step(b, "Pause")).to_have_attribute("data-row", str(row + 1))
        r = w.api().put(w.apath("a", "/draft/steps/s1"), {"fields": {"seconds": 9}})
        assert r.status_code == 409, r.text
    s1 = w.draft("a")["steps"][0]
    assert s1["row"] == row + 1 and s1["fields"]["seconds"] == 7


def test_wf_live_run_list_test_toggle_by_keyboard(browser, app_url):
    w = make_world(app_url, [auto("a", "Tester", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})],
                                  [E("trigger", "s1")], sample={"k": "v"})])
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        count = notes(pg, "Run list results")
        expect(count).to_contain_text("Runs shown: 0")
        cb = pg.get_by_role("checkbox", name="Show test runs")
        expect(cb).not_to_be_checked()
        key(cb, "Space")
        expect(cb).to_be_checked()
        _, n = w.start("a", test=True)
        item = run_item(pg, n, "Tester")
        expect(item).to_have_attribute("data-test", "true")
        expect(item).to_have_attribute("data-version", "")
        expect(item).to_have_attribute("data-status", "succeeded")
        expect(count).to_contain_text("Runs shown: 1")
        expect(notes(pg, "Run updates")).to_contain_text(f"Run #{n} succeeded")
        key(cb, "Space")
        expect(cb).not_to_be_checked()
        expect(item).to_have_count(0)
        expect(count).to_contain_text("Runs shown: 0")


def test_wf_live_run_list_waiting_filter_live(browser, app_url):
    w = make_world(app_url, [nap(name="Dozer")])
    with ui(browser, w, "owner", w.url("/runs"), size=VIEW_DESKTOP) as pg:
        count, log = notes(pg, "Run list results"), notes(pg, "Run updates")
        select(pg.get_by_role("combobox", name="Status"), "waiting")
        expect(count).to_contain_text("Runs shown: 0")
        _, n = w.start("a")
        item = run_item(pg, n, "Dozer")
        expect(item).to_have_attribute("data-status", "waiting")
        expect(count).to_contain_text("Runs shown: 1")
        expect(log).to_contain_text(waiting_at(n, "Sleeper"))
        w.tick(WAIT_S + CLOCK_SLACK_S)
        expect(log).to_contain_text(f"Run #{n} succeeded")
        expect(item).to_have_count(0)
        expect(count).to_contain_text("Runs shown: 0")


def test_wf_live_run_list_other_workspace_never_announced(browser, app_url):
    one = lambda name: auto("a", name, "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"a": "1"}})], [E("trigger", "s1")])
    mine, theirs = make_world(app_url, [one("Ours")]), make_world(app_url, [one("Theirs")])
    with ui(browser, mine, "owner", mine.url("/runs"), size=VIEW_DESKTOP) as pg:
        count, log = notes(pg, "Run list results"), notes(pg, "Run updates")
        expect(count).to_contain_text("Runs shown: 0")
        other_run, _ = theirs.start("a")
        wait_run(theirs, other_run, "succeeded")
        my_run, n = mine.start("a")
        expect(run_item(pg, n, "Ours")).to_have_attribute("data-status", "succeeded")
        expect(log).to_contain_text(f"Run #{n} succeeded")
        lines = [x.strip() for x in log.inner_text().splitlines() if x.strip()]
        assert lines.count(f"Run #{n} started") == 1 and lines.count(f"Run #{n} succeeded") == 1, lines
        expect(pg.locator(f'[data-run-id="{other_run}"]')).to_have_count(0)
        expect(pg.get_by_role("link", name=run_title(1, "Theirs"), exact=True)).to_have_count(0)
        expect(count).to_contain_text("Runs shown: 1")


def test_wf_replay_from_step_reused_log_by_keyboard(browser, app_url):
    w = replay_world(app_url)
    rid = w.rid("a", "r2")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        select(pg.get_by_role("combobox", name="Replay from", exact=True), "Hook call")
        key(pg.get_by_role("button", name="Replay", exact=True), "Enter")
        expect(summary(pg)).to_have_attribute("data-replay-of", rid)
        expect(pg).not_to_have_url(re.compile(rf"/runs/{rid}$"))
        expect(summary(pg)).to_contain_text("Version 1")
        mail_step = step(pg, "Mail out")
        key(mail_step, "Enter")
        dlg = pg.get_by_role("dialog", name=log_title("Mail out"))
        expect(dlg.get_by_role("list", name="Log")).to_contain_text("Reused output from run #2")
        expect(dlg.get_by_role("group", name="Output")).to_contain_text(REC_SUBJECT)
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("succeeded")
        pg.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(mail_step).to_be_focused()


def test_wf_replay_from_step_viewer_hears_replay(browser, app_url):
    w = replay_world(app_url)
    rid = w.rid("a", "r2")
    with ui(browser, w, "viewer", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as v, ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as o:
        vr = v.get_by_role("button", name="Replay", exact=True)
        expect(vr).to_be_disabled()
        expect(vr).to_have_accessible_description(C_VIEWER_REASON)
        select(o.get_by_role("combobox", name="Replay from", exact=True), "Hook call")
        key(o.get_by_role("button", name="Replay", exact=True), "Space")
        expect(summary(o)).to_have_attribute("data-replay-of", rid)
        expect(notes(v, "Run updates")).to_contain_text("Run #3 started")
        expect(summary(v)).to_have_attribute("data-run-id", rid)
        expect(summary(v)).to_have_attribute("data-status", "failed")


def test_wf_replay_from_step_failed_again_back_to_original(browser, app_url):
    w = replay_world(app_url)
    rid = w.rid("a", "r2")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        select(pg.get_by_role("combobox", name="Replay from", exact=True), "Hook call")
        key(pg.get_by_role("button", name="Replay", exact=True), "Enter")
        expect(summary(pg)).to_have_attribute("data-replay-of", rid)
        w.settle_retries()
        expect(summary(pg)).to_have_attribute("data-status", "failed")
        expect(notes(pg, "Run updates")).to_contain_text(failed_at(3, "Hook call"))
        links = summary(pg).get_by_role("link")
        hrefs = links.evaluate_all("els => els.map(e => e.getAttribute('href') || '')")
        back = [i for i, h in enumerate(hrefs) if h.endswith(w.url(f"/runs/{rid}"))]
        assert back, f"run summary of a replay has no link to the original run: {hrefs}"
        key(links.nth(back[0]), "Enter")
        expect(pg).to_have_url(re.compile(rf"/w/{w.id}/runs/{rid}$"))
        expect(pg.get_by_role("heading", level=1, name=run_title(2, "Intake"))).to_be_visible()


def test_wf_phone_run_log_tap_waiting_step(browser, app_url):
    w = phone_world(app_url)
    rid = w.rid("a", "r1")
    due = by_id(run_detail(w, rid))["s2"]["due_at"]
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE) as pg:
        tap(step(pg, "Sleeper"))
        dlg = pg.get_by_role("dialog", name=log_title("Sleeper"))
        expect(dlg.get_by_role("group", name="Status")).to_contain_text("waiting")
        expect(dlg.get_by_role("group", name="Timing")).to_contain_text("Due: " + fmt(due))
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()
        w.tick(C_PHONE_WAIT_S + CLOCK_SLACK_S)
        item = pg.get_by_role("list", name="Steps").get_by_role("listitem").filter(has=step(pg, "Sleeper"))
        expect(item).to_have_attribute("data-status", "succeeded")
        tap(step(pg, "Sleeper"))
        expect(dlg.get_by_role("list", name="Log")).to_contain_text(f"Attempt 1 of {ATTEMPTS} succeeded")
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_phone_run_log_editor_list_tap_settings(browser, app_url):
    w = phone_world(app_url)
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_PHONE) as pg:
        steps_ = pg.get_by_role("list", name="Steps")
        expect(steps_).to_be_visible()
        expect(pg.get_by_role("region", name="Automation canvas")).to_be_hidden()
        expect(pg.get_by_role("toolbar", name="Step kinds")).to_be_hidden()
        ids = steps_.get_by_role("listitem").evaluate_all("els => els.map(e => e.dataset.stepId)")
        assert {"s1", "s2", "s3"} <= set(ids), ids
        greeter = steps_.get_by_role("button", name=C_GREETER, exact=True)
        tap(greeter)
        dlg = pg.get_by_role("dialog", name=settings_title(C_GREETER))
        expect(dlg.get_by_role("textbox", name="Step name")).to_have_value(C_GREETER)
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()
        expect(greeter).to_be_focused()


def test_wf_phone_run_log_reduced_motion_log_targets(browser, app_url):
    w = phone_world(app_url)
    rid = w.rid("a", "r1")
    with ui(browser, w, "owner", w.url(f"/runs/{rid}"), size=VIEW_PHONE, reduced_motion="reduce") as pg:
        items = pg.get_by_role("list", name="Steps").get_by_role("listitem")
        expect(items.first).to_be_visible()
        anims = items.evaluate_all("els => els.map(e => e.dataset.anim)")
        assert anims and set(anims) == {"none"}, anims
        tap(step(pg, "Greeter"))
        dlg = pg.get_by_role("dialog", name=log_title("Greeter"))
        expect(dlg).to_be_visible()
        layout(pg)
        for loc in dlg.get_by_role("button").all():
            if loc.is_visible():
                box = loc.bounding_box()
                assert box["width"] >= TOUCH_MIN - 0.5 and box["height"] >= TOUCH_MIN - 0.5, box
        tap(dlg.get_by_role("button", name="Close", exact=True))
        expect(dlg).to_be_hidden()


def test_wf_viewer_boundaries_invite_problem_alert_focus(browser, app_url, mail):
    w = make_world(app_url, [nap(name=C_SHOWN)], roles=("owner",))
    invitee = f"viewer-{new_tag()}@x.example"
    assert w.api().post(f"/api/workspaces/{w.id}/invites", {"email": invitee, "role": "viewer"}).status_code == 201
    link = re.search(r"https?://\S+?(/invite/[\w-]+)", mail_text(mails_to(mail, invitee)[0])).group(1)
    with open_app(browser, app_url + link) as vp:
        expect(vp.get_by_role("heading", level=1, name=f"Join Space {w.tag}")).to_be_visible()
        fill(vp.get_by_role("textbox", name="Name"), "Vera Viewer")
        pw = vp.get_by_role("textbox", name="Password")
        fill(pw, C_SHORT_PW)
        key(vp.get_by_role("button", name="Join workspace", exact=True), "Enter")
        msg = vp.get_by_role("alert", name="Problem").get_by_role("link", name="Password must be at least 8 characters")
        expect(msg).to_be_visible()
        key(msg, "Enter")
        expect(pw).to_be_focused()
        pw.fill(PASSWORD)
        key(vp.get_by_role("button", name="Join workspace", exact=True), "Enter")
        expect(vp).to_have_url(re.compile(rf"/w/{w.id}$"))
        expect(vp.get_by_role("list", name="Automations")).to_contain_text(C_SHOWN)


def test_wf_viewer_boundaries_settings_disabled_by_keyboard(browser, app_url):
    w = make_world(app_url, [nap()])
    with ui(browser, w, "viewer", w.editor("a"), size=VIEW_DESKTOP) as pg:
        dlg = open_settings(pg, "Sleeper")
        for loc in (dlg.get_by_role("textbox", name="Step name"), dlg.get_by_role("spinbutton", name="Seconds")):
            expect(loc).to_be_disabled()
            expect(loc).to_have_accessible_description(C_VIEWER_REASON)
        key(dlg.get_by_role("button", name="Close", exact=True), "Enter")
        expect(dlg).to_be_hidden()
        expect(step(pg, "Sleeper")).to_be_focused()


def test_wf_viewer_boundaries_not_found_by_keyboard(browser, app_url):
    mine = make_world(app_url, roles=("owner", "viewer"))
    theirs = make_world(app_url, [nap(name=C_HIDDEN, runs=[R("r1")])], roles=("owner",))
    rid = theirs.rid("a", "r1")
    with ui(browser, mine, "viewer", theirs.url(f"/runs/{rid}"), size=VIEW_DESKTOP) as pg:
        expect(pg.get_by_role("heading", level=1, name=C_NOT_FOUND)).to_be_visible()
        expect(pg.get_by_text(C_NOT_FOUND_LINE)).to_be_visible()
        expect(pg.get_by_role("heading", level=1, name=run_title(1, C_HIDDEN))).to_have_count(0)
        expect(pg.locator(f'[data-run-id="{rid}"]')).to_have_count(0)
        key(pg.get_by_role("link", name="Back to start", exact=True), "Enter")
        expect(pg).to_have_url(app_url + "/")


def test_wf_viewer_boundaries_invite_by_keyboard_replaces(browser, app_url, mail):
    w = make_world(app_url, roles=("owner",))
    invitee = f"inv-{new_tag()}@x.example"
    subject = f"{w.uname('owner')} invited you to Space {w.tag} on Pinbyte Switchyard"
    with ui(browser, w, "owner", w.url("/members"), size=VIEW_DESKTOP) as pg:
        pending = pg.get_by_role("list", name="Pending invites").get_by_role("listitem").filter(has_text=invitee)
        for role in ("viewer", "editor"):
            fill(pg.get_by_role("textbox", name="Invitee email"), invitee)
            select(pg.get_by_role("combobox", name="Role"), role)
            key(pg.get_by_role("button", name="Send invite", exact=True), "Enter")
            expect(notes(pg, "Notices")).to_contain_text(f"Invite sent to {invitee}")
            expect(pending).to_have_count(1)
    msgs = mails_to(mail, invitee, expected=2)
    assert all(m["Subject"] == subject and re.search(r"/invite/[\w-]+", mail_text(m)) for m in msgs)
    invites = [i for i in w.api().get(f"/api/workspaces/{w.id}/members").json()["invites"] if i["email"] == invitee]
    assert [i["role"] for i in invites] == ["editor"], invites


def test_wf_export_import_export_after_first_publish(browser, app_url):
    w = make_world(app_url, [auto("a", "Fresh export", "manual", {}, [S("s1", "set", "Setter", 2, {"values": {"g": "hi"}})],
                                  [E("trigger", "s1")], live=False)])
    with ui(browser, w, "owner", w.editor("a"), size=VIEW_DESKTOP) as pg:
        btn = pg.get_by_role("button", name="Export live version", exact=True)
        expect(btn).to_be_disabled()
        expect(btn).to_have_accessible_description(re.compile(r"\S"))
        key(pg.get_by_role("button", name="Publish", exact=True), "Enter")
        expect(pg.get_by_role("group", name="Version drain")).to_have_attribute("data-live-version", "1")
        expect(btn).to_be_enabled()
        with pg.expect_download() as dl:
            key(btn, "Enter")
        expect(notes(pg, "Notices")).to_contain_text("Export saved")
        raw = Path(dl.value.path()).read_bytes()
    assert S3().get(f"exports/{w.id}/{w.aid('a')}/v1.json") == raw
    doc, old = json.loads(raw), w.draft("a")
    assert [(s["id"], s["kind"], s["name"]) for s in doc["steps"]] == [(s["id"], s["kind"], s["name"]) for s in old["steps"]]
