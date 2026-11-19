import csv
import io
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
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import expect

from conftest import (DEPLOYED_APP, S3, addresses, advance, center, click, check, fill, layout,
                      licence_allowed, mail_from_address, open_app, post_json, same_origin, select,
                      session, shipped_packages, state_styles, style, animations, tab_order, tap, text, until)

GRADING = {"X-Everyweek-Grading": "1"}
PW = "weekly-demo-1"
HTTP_S = 60
LIVE_WAIT_MS = 5000
POLL_S = 0.2
COPY_START_S = 180
HEALTH_MAX_S = 3
BODY_CAP = 262144
UPLOAD_CAP = 1048576
TOP_BAR_PX = 56
TAP_MIN_PX = 44
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0", "CC0-1.0", "OFL-1.1"}
CONFIRM_KINDS = ["task", "section", "field"]
TAGS = {"key": "tags", "name": "Tags", "type": "multi_select", "options": ["Fresh", "Dry", "Frozen"]}
_tick = threading.Event()
CORS_HEADER = "access-control-allow-origin"
LOCKFILE_MARK = "lockfileVersion"
SOURCE_MARKS = (LOCKFILE_MARK, "run-manifest-v1", '"dependencies"', '"devDependencies"', '"compilerOptions"', '"scripts"',
                "DATABASE_URL=", "S3_SECRET_ACCESS_KEY=")
GATE_RULE = "Gate"
LOW_CAP = 2


def uid():
    return uuid.uuid4().hex[:8]


def F(key, name, kind, **kw):
    return {"key": key, "name": name, "type": kind, **kw}


def T(key, name, section="To do", **kw):
    return {"key": key, "name": name, "section": section, **kw}


def eventually(fn, what, seconds=10):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        _tick.wait(POLL_S)
    pytest.fail(f"expected {what}; last value {last!r}")


def seed(base, body):
    r = post_json(base, "/grading/seed", body, **GRADING)
    assert r.status_code == 201, f"seed -> {r.status_code} {r.text[:400]}"
    return r.json()


def clock(base, now):
    r = post_json(base, "/grading/clock", {"now": now}, **GRADING)
    assert r.status_code == 200, f"clock -> {r.status_code} {r.text[:300]}"
    return r.json()


def client(base, email):
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    r = c.post("/api/signin", json={"email": email, "password": PW})
    assert r.status_code == 200, f"signin {email} -> {r.status_code} {r.text[:200]}"
    return c


def world(base, sections=("To do", "Doing"), fields=(), tasks=(), rules=(), forms=(), deps=(), capacities=(), goals=(), history=()):
    n = uid()
    people = [{"key": k, "name": f"{k.title()} {n}", "email": f"{k}.{n}@example.test", "password": PW, "verified": True}
              for k in ("noor", "ilse", "tomas")]
    body = {"people": people,
            "teams": [{"key": "t", "name": f"Team {n}", "members": ["noor", "ilse", "tomas"], "coordinators": ["noor"], "joinCode": f"JOIN-{n}"}],
            "capacities": list(capacities),
            "projects": [{"key": "p", "team": "t", "name": f"Project {n}", "sections": list(sections), "fields": list(fields),
                          "tasks": list(tasks), "rules": list(rules), "forms": list(forms), "dependencies": list(deps)}],
            "goals": list(goals), "history": list(history)}
    res = seed(base, body)
    return SimpleNamespace(
        n=n, base=base, res=res, team=res["teams"]["t"], team_name=f"Team {n}", project=res["projects"]["p"],
        sections=res["sections"]["p"], fields=res.get("fields", {}), tasks=res.get("tasks", {}),
        who={p["key"]: SimpleNamespace(id=res["people"][p["key"]], name=p["name"], email=p["email"]) for p in people})


def all_tasks(c, pid):
    out = []
    for page in range(1, 60):
        j = c.get(f"/api/projects/{pid}/tasks", params={"page": page}).json()
        out += j["tasks"]
        if not j["tasks"] or len(out) >= j["total"]:
            return out
    pytest.fail("task pagination did not end")


def mk(c, pid, name, **kw):
    r = c.post(f"/api/projects/{pid}/tasks", json={"name": name, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def patch(c, tid, **fields):
    v = c.get(f"/api/tasks/{tid}").json()["version"]
    return c.patch(f"/api/tasks/{tid}", json={"version": v, **fields})


def get_task(c, tid):
    return c.get(f"/api/tasks/{tid}").json()


@contextmanager
def view(browser, base, email, path, size=None, reduced="no-preference", live=True, block_events=False):
    with open_app(browser, base + "/account", reduced_motion=reduced) as pg:
        if email:
            c = client(base, email)
            pg.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in c.cookies.items()])
        if size:
            pg.set_viewport_size(size)
        if block_events:
            pg.route("**/api/events", lambda route: route.abort())
        try:
            if email and live and not block_events:
                with pg.expect_response(lambda r: "/api/events" in r.url, timeout=LIVE_WAIT_MS * 2):
                    pg.goto(base + path)
            else:
                pg.goto(base + path)
        except PWTimeout:
            pass
        yield pg


def vis(loc):
    expect(loc).to_be_visible(timeout=LIVE_WAIT_MS)


def gone(loc):
    expect(loc).to_have_count(0, timeout=LIVE_WAIT_MS)


def foc(loc):
    expect(loc).to_be_focused(timeout=LIVE_WAIT_MS)


def has(loc, s):
    expect(loc).to_have_text(s, timeout=LIVE_WAIT_MS)


def clocked_has(pg, loc, want, seconds=30):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = " ".join((loc.text_content() or "").split()) if loc.count() == 1 else None
        if last == want:
            return
        advance(pg, 250)
    pytest.fail(f"expected {want!r}; last text {last!r}")


def attr(loc, name, v):
    expect(loc).to_have_attribute(name, v, timeout=LIVE_WAIT_MS)


def st(pg, name):
    return pg.get_by_role("status", name=name, exact=True)


def ob(pg, name):
    return pg.get_by_role("button", name=f"Open {name}", exact=True)


def detail(pg, name):
    return (pg.get_by_role("dialog", name=f"Task: {name}", exact=True)
            .or_(pg.get_by_role("complementary", name=f"Task: {name}", exact=True)))


def active_in(loc):
    return loc.evaluate("e => e.contains(document.activeElement)")


def row_of_active(pg):
    return pg.evaluate("() => (document.activeElement.closest('[role=row]') || {}).innerText || ''")


def press(pg, *ks):
    for k in ks:
        pg.keyboard.press(k)


BODY_FOCUS_JS = "() => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected"
STALE_TOAST = "This task changed. Try again."


def focus_kept(pg, what):
    eventually(lambda: not pg.evaluate(BODY_FOCUS_JS), f"focus off the page body after {what}", seconds=LIVE_WAIT_MS / 1000)


def card(pg, name, section, i, n):
    return pg.get_by_role("button", name=f"{name}, {section}, position {i} of {n}", exact=True)


def choose(locator, choice):
    if locator.evaluate("e => e.tagName === 'SELECT'"):
        select(locator, choice)
        return
    center(locator)
    locator.focus()
    locator.click()
    locator.page.get_by_role("option", name=choice, exact=True).first.click()
    if locator.evaluate("e => e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement"):
        expect(locator).to_have_value(re.compile(re.escape(choice)))
    else:
        expect(locator).to_contain_text(choice)


def shown(loc):
    return loc.evaluate("e => String(e.value ?? e.textContent ?? '').trim()")


def mail_for(mail, email, tries=40):
    def find():
        found = [m for m in mail.messages(expected=1, settle=0.3) if email in [a.lower() for a in addresses(m.get("To"))]]
        return found
    return eventually(find, f"mail to {email}", seconds=tries)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def copy_of_app(extra_env):
    port = free_port()
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "EVERYWEEK_GRADING": "1", **extra_env}
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        base = f"http://127.0.0.1:{port}"
        try:
            healthy = False
            for _ in range(COPY_START_S):
                if proc.poll() is not None:
                    break
                try:
                    healthy = httpx.get(base + "/api/health", timeout=5).status_code == 200
                except httpx.HTTPError:
                    healthy = False
                if healthy:
                    break
                _tick.wait(1)
            if not healthy:
                log.seek(0)
                pytest.fail(f"app copy did not become healthy; log tail: {log.read()[-1500:]}")
            yield base
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)


def chain_world(base):
    rules = [
        {"key": "r1", "name": "Ready to review", "trigger": {"type": "field_changed", "field": "stage", "value": "Ready"},
         "action": {"type": "move_to_section", "target": "Review"}},
        {"key": "r2", "name": "Review sets owner", "trigger": {"type": "moved_to_section", "section": "Review"},
         "action": {"type": "assign_to", "target": "noor"}},
        {"key": "r3", "name": "Owner flags", "trigger": {"type": "field_changed", "field": "assignee"},
         "action": {"type": "set_field", "target": "prio", "value": "High"}},
        {"key": "r4", "name": "High priority notice", "trigger": {"type": "field_changed", "field": "prio", "value": "High"},
         "action": {"type": "set_field", "target": "stage", "value": "Ready"}},
        {"key": "r5", "name": "Gate", "trigger": {"type": "task_added"}, "condition": {"field": "prio", "op": "is", "value": "High"},
         "action": {"type": "set_field", "target": "stage", "value": "Draft"}}]
    for i, r in enumerate(rules):
        r["position"] = i + 1
    return world(base, sections=("To do", "Review"),
                 fields=[F("stage", "Stage", "single_select", options=["Draft", "Ready", "Review"]),
                         F("prio", "Priority", "single_select", options=["Low", "Medium", "High"])],
                 tasks=[T("t", "Weigh stock")], rules=rules)


def runs(c, tid):
    return c.get(f"/api/tasks/{tid}/rule-runs").json()["runs"]


def added_runs(c, tid):
    return eventually(lambda: runs(c, tid), "rule runs recorded for the new task")


def mk_ran(c, pid, name, **kw):
    t = mk(c, pid, name, **kw)
    added_runs(c, t["id"])
    return t


def goal_world(base):
    n = uid()
    ppl = [{"key": k, "name": f"{k.title()} {n}", "email": f"{k}.{n}@example.test", "password": PW, "verified": True} for k in ("noor", "ilse")]

    def jobs(prefix, total, done):
        return [{"key": f"{prefix}{i}", "name": f"{prefix} job {i}", "section": "To do", "completed": i < done} for i in range(total)]
    names = {k: f"{v} {n}" for k, v in {"root": "Run a steady year", "kit": "Kitchen runs on time", "upk": "Upkeep never lapses",
                                        "sup": "Suppliers confirmed", "spa": "Spare parts stocked"}.items()}
    body = {"people": ppl, "teams": [{"key": "t", "name": f"Team {n}", "members": ["noor", "ilse"], "coordinators": ["noor"]}],
            "projects": [{"key": "p1", "team": "t", "name": f"Weekly orders {n}", "sections": ["To do"],
                          "tasks": jobs("a", 8, 6) + [{"key": "asub", "name": "a sub", "section": "To do", "parent": "a0", "completed": False}]},
                         {"key": "p2", "team": "t", "name": f"Machine upkeep {n}", "sections": ["To do"], "tasks": jobs("b", 5, 2)}],
            "goals": [{"key": "root", "team": "t", "name": names["root"], "owner": "noor"},
                      {"key": "kit", "team": "t", "name": names["kit"], "parent": "root", "weight": 2, "owner": "noor", "projects": [{"project": "p1", "weight": 3}]},
                      {"key": "upk", "team": "t", "name": names["upk"], "parent": "root", "weight": 1, "owner": "noor", "projects": [{"project": "p2", "weight": 1}]},
                      {"key": "sup", "team": "t", "name": names["sup"], "parent": "kit", "weight": 1, "manual": 40, "owner": "noor"},
                      {"key": "spa", "team": "t", "name": names["spa"], "parent": "upk", "weight": 1, "manual": 90, "owner": "noor"}]}
    res = seed(base, body)
    return SimpleNamespace(n=n, base=base, names=names, ids=res["goals"], team=res["teams"]["t"], res=res,
                           who={p["key"]: SimpleNamespace(id=res["people"][p["key"]], name=p["name"], email=p["email"]) for p in ppl})


def goals_by_name(c, team):
    return {g["name"]: g for g in c.get(f"/api/teams/{team}/goals").json()["goals"]}


def workload_world(base):
    return world(base, capacities=[{"person": "noor", "weekday": "fri", "hours": 4}], tasks=[
        T("a", "Order dry goods", start="2026-03-02", due="2026-03-04", effort=12, assignee="noor"),
        T("b", "Pack orders", start="2026-03-04", due="2026-03-06", effort=10, assignee="noor"),
        T("c", "Count freezer", start="2026-03-06", due="2026-03-09", effort=5, assignee="noor"),
        T("d", "Done job", start="2026-03-02", due="2026-03-06", effort=40, assignee="noor", completed=True),
        T("e", "Nobody job", start="2026-03-02", due="2026-03-06", effort=40)])


def cells_of(c, w, person, frm="2026-03-02"):
    j = c.get(f"/api/teams/{w.team}/workload", params={"from": frm}).json()
    p = next(p for p in j["people"] if p["id"] == person.id)
    return j, {x["date"]: x for x in p["cells"]}


def wcell(pg, who, date):
    sel = ", ".join(f'[data-person="{i}"][data-date="{date}"]' for i in (who.id, who.name, who.email))
    return pg.locator(sel)


def form_world(base):
    return world(base, fields=[F("cat", "Category", "single_select", options=["Dry goods", "Fresh", "Equipment"])],
                 forms=[{"key": "f", "slug": f"req-{uid()}", "section": "To do", "title": "Supply request"}])


def form_slug(w):
    return w.res["forms"]["f"] if False else None


@pytest.fixture
def down_url():
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def test_health_and_starter_seed(app_url, down_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_S)
    assert (r.status_code, r.json()) == (200, {"status": "ok"})
    t0 = time.monotonic()
    r = httpx.get(down_url + "/api/health", timeout=HTTP_S)
    assert (r.status_code, r.json()) == (200, {"status": "unavailable"})
    assert time.monotonic() - t0 < HEALTH_MAX_S
    c = client(app_url, "noor@everyweek.example")
    team = next(t for t in c.get("/api/me").json()["teams"] if t["name"] == "Larder Street Kitchen")
    assert team["role"] == "coordinator"
    projects = {p["name"]: p for p in c.get(f"/api/teams/{team['id']}/projects").json()["projects"]}
    assert {"Weekly orders", "Machine upkeep"} <= set(projects)
    pj = c.get(f"/api/projects/{projects['Weekly orders']['id']}").json()
    assert [s["name"] for s in pj["sections"]] == ["To do", "Doing", "Review", "Done"]
    fields = {f["name"]: f for f in pj["fields"]}
    assert {"Stage", "Priority", "Tags", "Category", "Rate", "Extra", "Cost"} <= set(fields)
    assert fields["Cost"]["type"] == "formula" and fields["Cost"]["formula"] == "{Effort} * {Rate}"
    names = {t["name"] for t in all_tasks(c, pj["id"])}
    assert {"Order dry goods", "Pack orders", "Count freezer", "Weigh stock"} <= names


def test_grading_seed_and_clock(app_url, down_url):
    rule = {"key": "r", "name": "Seed rule", "trigger": {"type": "task_added"}, "action": {"type": "send_to_inbox"}}
    w = world(app_url, tasks=[T("a", "Alpha", due="2026-03-02")], rules=[rule],
              history=[{"task": "a", "text": "Weigh stock", "createdAt": "2026-01-05T08:00:00Z"}])
    assert w.tasks["a"] and w.res["rules"]["r"] and len(w.res["people"]) == 3
    c = client(app_url, w.who["noor"].email)
    t = get_task(c, w.tasks["a"])
    assert any(h["text"] == "Weigh stock" and h["createdAt"].startswith("2026-01-05T08:00:00") for h in t["history"])
    assert runs(c, w.tasks["a"]) == []
    assert c.get("/api/inbox").json()["items"] == []
    assert world(down_url).project
    now = clock(app_url, "2026-03-01T09:00:00Z")["now"]
    assert datetime.fromisoformat(now.replace("Z", "+00:00")) == datetime.fromisoformat("2026-03-01T09:00:00+00:00")
    assert get_task(c, w.tasks["a"])["dueStatus"] == "later"
    clock(down_url, "2026-03-02T09:00:00Z")
    assert get_task(c, w.tasks["a"])["dueStatus"] == "today"
    clock(app_url, "2026-03-03T09:00:00Z")
    assert get_task(c, w.tasks["a"])["dueStatus"] == "overdue"
    assert patch(c, w.tasks["a"], completed=True).json()["dueStatus"] == "none"


def test_my_work_groups_follow_server_clock(browser, app_url):
    w = world(app_url, tasks=[T("o", "Overdue job", due="2026-03-01", assignee="noor"), T("d", "Today job", due="2026-03-02", assignee="noor"),
                              T("l", "Later job", due="2026-03-05", assignee="noor"), T("x", "Open job", assignee="noor"),
                              T("c", "Count freezer", due="2026-03-01", assignee="noor", completed=True)])
    clock(app_url, "2026-03-02T09:00:00Z")
    with view(browser, app_url, w.who["noor"].email, "/") as pg:
        pg.clock.set_fixed_time("2040-06-01T12:00:00Z")
        pg.reload()
        vis(pg.get_by_role("heading", name="My work", exact=True))
        ys = []
        for label in ("Overdue", "Due today", "Later", "No due date"):
            el = pg.get_by_text(label, exact=True).first
            vis(el)
            ys.append(el.bounding_box()["y"])
        assert ys == sorted(ys)
        for nm in ("Overdue job", "Today job", "Later job", "Open job"):
            vis(pg.get_by_text(nm))
        gone(pg.get_by_text("Count freezer"))


def test_error_order_and_shapes(app_url, down_url):
    w, other = world(app_url, tasks=[T("a", "Alpha")]), world(app_url, tasks=[T("x", "Other")])
    tid = w.tasks["a"]
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    for method, path in [("GET", f"/api/projects/{w.project}"), ("GET", "/api/projects/unknown-" + uid()),
                         ("POST", f"/api/projects/{w.project}/tasks"), ("PATCH", f"/api/tasks/{tid}")]:
        r = anon.request(method, path, json={})
        assert (r.status_code, r.json()) == (401, {"error": "unauthenticated"}), path
    c = client(app_url, w.who["noor"].email)
    for path in (f"/api/projects/{other.project}", f"/api/projects/{other.project}/tasks", "/api/projects/unknown-" + uid(),
                 f"/api/tasks/{other.tasks['x']}", "/api/nope-" + uid()):
        r = c.get(path)
        assert (r.status_code, r.json()) == (404, {"error": "not_found"}), path
    m = client(app_url, w.who["ilse"].email)
    r = m.post(f"/api/teams/{w.team}/projects", json={})
    assert (r.status_code, r.json()) == (403, {"error": "forbidden"})
    r = c.post(f"/api/teams/{w.team}/projects", json={"name": "", "sections": []})
    assert r.status_code == 422
    assert r.json()["errors"] == {"name": "Enter a project name", "sections": "Add at least one section"}
    v = get_task(c, tid)["version"]
    assert c.patch(f"/api/tasks/{tid}", json={"version": v, "name": "Alpha 2"}).status_code == 200
    r = c.patch(f"/api/tasks/{tid}", json={"version": v, "effort": -1})
    assert (r.status_code, r.json()) == (409, {"error": "stale_task", "latest": v + 1})
    r = c.patch(f"/api/tasks/{tid}", json={"version": v + 1, "effort": -1})
    assert (r.status_code, r.json()) == (422, {"errors": {"effort": "Effort must be 0 or more hours"}})
    r = c.post(f"/api/projects/{w.project}/tasks", content=b"{", headers={"content-type": "application/json"})
    assert (r.status_code, r.json()) == (422, {"errors": {"body": "Send a JSON body"}})
    d = client(down_url, w.who["noor"].email)
    r = d.post(f"/api/tasks/{tid}/attachments", files={"note": (None, "x")})
    assert (r.status_code, r.json()) == (503, {"error": "storage_unavailable"})
    r = d.post(f"/api/tasks/{tid}/attachments", files={"file": ("big.bin", b"x" * (UPLOAD_CAP + 1))})
    assert (r.status_code, r.json()) == (413, {"error": "file_too_large"})


def test_env_limits_defaults(app_url):
    r = httpx.get(app_url + "/api/config", timeout=HTTP_S)
    assert r.json() == {"moveMs": 320, "progressMs": 400, "toastMs": 4000, "holdTimeoutMs": 30000}
    w = world(app_url, tasks=[T(f"t{i}", f"Task {i:02d}") for i in range(51)])
    c = client(app_url, w.who["noor"].email)
    p1 = c.get(f"/api/projects/{w.project}/tasks", params={"page": 1}).json()
    p2 = c.get(f"/api/projects/{w.project}/tasks", params={"page": 2}).json()
    assert p1["pageSize"] == 50 and len(p1["tasks"]) == 50 and p1["total"] == 51
    assert len(p2["tasks"]) == 1


def test_env_limits_override():
    env = {"EVERYWEEK_MOVE_MS": "500",
           "EVERYWEEK_PROGRESS_MS": "700",
           "EVERYWEEK_TOAST_MS": "1500",
           "EVERYWEEK_HOLD_TIMEOUT_MS": "5000",
           "EVERYWEEK_PAGE_SIZE": "2", "EVERYWEEK_FORMULA_MAX_CHARS": "40", "EVERYWEEK_FORMULA_MAX_STEPS": "5",
           "EVERYWEEK_UPLOAD_MAX_BYTES": "2000",
           "EVERYWEEK_RULE_MAX_DEPTH": "1", "EVERYWEEK_RULE_RUNS_PER_MINUTE": "2"}
    with copy_of_app(env) as base:
        assert httpx.get(base + "/api/config", timeout=HTTP_S).json() == {"moveMs": 500, "progressMs": 700, "toastMs": 1500, "holdTimeoutMs": 5000}
        w = chain_world(base)
        c = client(base, w.who["noor"].email)
        assert patch(c, w.tasks["t"], values={"Stage": "Ready"}).status_code == 200
        got = [r["summary"] for r in runs(c, w.tasks["t"])]
        assert got == ["Ready to review ran: moved to Review", "Stopped: chain depth limit 1 reached at Review sets owner"]
        for i in range(2):
            mk(c, w.project, f"Extra {i}")
        page = c.get(f"/api/projects/{w.project}/tasks", params={"page": 1}).json()
        assert page["pageSize"] == 2 and len(page["tasks"]) == 2
        v = world(base, fields=[F("a", "Calc", "formula", formula="1")], tasks=[T("t", "Alpha", effort=2)])
        vc = client(base, v.who["noor"].email)
        fid = v.fields["a"]
        cap = int(env["EVERYWEEK_FORMULA_MAX_CHARS"])
        r = vc.patch(f"/api/fields/{fid}", json={"formula": '"' + "a" * cap + '"'})
        assert r.status_code == 422 and r.json()["errors"]["formula"] == f"Formula error at character {cap + 1}: formula is longer than {cap} characters"
        assert vc.patch(f"/api/fields/{fid}", json={"formula": "{Effort}+{Effort}+{Effort}"}).status_code == 200
        assert get_task(vc, v.tasks["t"])["values"]["Calc"] == 6
        assert vc.patch(f"/api/fields/{fid}", json={"formula": "{Effort}+{Effort}+{Effort}+{Effort}"}).status_code == 200
        assert get_task(vc, v.tasks["t"])["values"]["Calc"] == "#BUDGET"
        r = vc.post(f"/api/tasks/{v.tasks['t']}/attachments", files={"file": ("a.bin", b"x" * 2001)})
        assert (r.status_code, r.json()) == (413, {"error": "file_too_large"})
        here = datetime.fromisoformat(runs(c, w.tasks["t"])[0]["createdAt"].replace("Z", "+00:00"))
        clock(base, (here.replace(second=0, microsecond=0) + timedelta(minutes=1, seconds=10)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        g = world(base, fields=[F("p", "Priority", "single_select", options=["Low", "High"])],
                  rules=[{"key": "r", "name": "Count", "trigger": {"type": "task_added"}, "action": {"type": "set_field", "target": "p", "value": "Low"}}])
        gc = client(base, g.who["noor"].email)
        created = [mk_ran(gc, g.project, f"N{i}") for i in range(3)]
        assert added_runs(gc, created[2]["id"])[-1]["summary"] == "Skipped: rule run limit 2 per minute reached"


def test_live_update_across_instances(browser, app_url, down_url):
    w = world(app_url, tasks=[T("a", "Alpha")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, down_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        entry = pg.get_by_role("textbox", name="Add task").first
        entry.focus()
        foc(entry)
        t = mk(c, w.project, f"Live {w.n}")
        vis(ob(pg, f"Live {w.n}"))
        foc(entry)
        assert patch(c, t["id"], name=f"Renamed {w.n}").status_code == 200
        vis(ob(pg, f"Renamed {w.n}"))
        gone(ob(pg, f"Live {w.n}"))
        assert c.delete(f"/api/tasks/{t['id']}").status_code == 204
        gone(ob(pg, f"Renamed {w.n}"))
        foc(entry)


def test_bar_move_on_page_clock(browser, app_url):
    w = world(app_url, tasks=[T("a", "Alpha", start="2026-03-02", due="2026-03-04")])
    for reduced in ("no-preference", "reduce"):
        with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=timeline", reduced=reduced) as pg:
            bar = pg.get_by_role("button", name="Alpha, 2026-03-02 to 2026-03-04" if reduced == "no-preference" else "Alpha, 2026-03-03 to 2026-03-05")
            vis(bar)
            bar.focus()
            pg.keyboard.press("ArrowRight")
            new = "Alpha, 2026-03-03 to 2026-03-05" if reduced == "no-preference" else "Alpha, 2026-03-04 to 2026-03-06"
            moved = pg.get_by_role("button", name=new)
            vis(moved)
            attr(moved, "data-start", "2026-03-03" if reduced == "no-preference" else "2026-03-04")
            if reduced == "no-preference":
                assert moved.get_attribute("data-motion") == "moving" and moved.get_attribute("data-move-progress") != "1.0000"
                advance(pg, 320)
                advance(pg, 16)
            attr(moved, "data-move-progress", "1.0000")
            attr(moved, "data-motion", "settled")


def test_run_entry_slide_on_page_clock(browser, app_url):
    for reduced in ("no-preference", "reduce"):
        w = chain_world(app_url)
        c = client(app_url, w.who["noor"].email)
        with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}", reduced=reduced) as pg:
            click(ob(pg, "Weigh stock"))
            panel = detail(pg, "Weigh stock")
            vis(panel)
            assert patch(c, w.tasks["t"], values={"Stage": "Ready"}).status_code == 200
            runs_list = panel.get_by_role("list", name="Rule runs")
            first = runs_list.locator("[data-depth]").first
            vis(first)
            if reduced == "reduce":
                attr(first, "data-slide-offset", "0.00")
                attr(first, "data-motion", "settled")
                continue
            attr(first, "data-motion", "entering")
            published = [8.0, 3.14, 0.98, 0.20]
            for i in range(3):
                advance(pg, 40)
                got = float(first.get_attribute("data-slide-offset"))
                assert published[i + 1] - 0.005 <= got <= published[i] + 0.005, (i, got)
            advance(pg, 80)
            assert first.get_attribute("data-slide-offset") == "0.00"
            attr(first, "data-motion", "settled")


def test_server_boundary(app_url):
    w = world(app_url)
    c = client(app_url, w.who["noor"].email)

    def body(total):
        return ('{"name":"' + "x" * (total - 11) + '"}').encode()
    ok = c.post(f"/api/projects/{w.project}/tasks", content=body(BODY_CAP), headers={"content-type": "application/json"})
    assert ok.status_code != 413
    big = c.post(f"/api/projects/{w.project}/tasks", content=body(BODY_CAP + 1), headers={"content-type": "application/json"})
    assert (big.status_code, big.json()) == (413, {"error": "body_too_large"})
    r = httpx.get(app_url + "/api/config", headers={"Origin": "http://evil.example"}, timeout=HTTP_S)
    assert CORS_HEADER not in {k.lower() for k in r.headers}
    secrets = [v for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if len(v := os.environ.get(k, "")) >= 6]
    for path in ("/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/run.json"):
        r = httpx.get(app_url + path, timeout=HTTP_S)
        assert not any(mark in r.text for mark in SOURCE_MARKS) and not any(v in r.text for v in secrets), path
    page = httpx.get(app_url + "/", timeout=HTTP_S).text
    assets = [app_url + a for a in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', page)]
    served = page + "".join(httpx.get(a, timeout=HTTP_S).text for a in assets)
    for key in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL"):
        val = os.environ.get(key, "")
        assert len(val) < 6 or val not in served, f"{key} value found in served assets"


def test_no_external_requests(browser, app_url):
    seen, fonts = [], []
    with open_app(browser, app_url + "/") as pg:
        pg.on("request", lambda r: seen.append(r.url))
        pg.on("response", lambda r: fonts.append(r.url) if r.request.resource_type == "font" else None)
        pg.reload()
        vis(pg.get_by_role("heading", level=1))
        pg.goto(app_url + "/account")
        vis(pg.get_by_role("button", name="Create account"))
        pg.goto(app_url + "/")
        family = pg.evaluate("() => getComputedStyle(document.body).fontFamily")
    assert "Instrument Sans" in family
    assert fonts and all(same_origin(u, app_url) for u in fonts)
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign


TOP_BAR_JS = """() => {
  const pos = e => getComputedStyle(e).position;
  const shown = e => { const b = e.getBoundingClientRect(), s = getComputedStyle(e); return b.width > 0 && b.height > 0 && b.height < innerHeight && s.visibility !== 'hidden' && s.display !== 'none'; };
  const pinned = [...document.querySelectorAll('*')].filter(e => (pos(e) === 'sticky' || pos(e) === 'fixed') && shown(e) && Math.abs(e.getBoundingClientRect().top) <= 1);
  const bars = pinned.filter(e => !pinned.some(o => o !== e && o.contains(e)));
  const strays = [...document.querySelectorAll('*')].filter(e => pos(e) === 'sticky' && !bars.some(b => b.contains(e))).length;
  return {heights: bars.map(e => Math.round(e.getBoundingClientRect().height)), shadow: bars.length === 1 && getComputedStyle(bars[0]).boxShadow !== 'none', strays};
}"""


def test_welcome_header_mega_menus(browser, app_url):
    with open_app(browser, app_url + "/") as pg:
        has(pg.get_by_role("heading", level=1), "Recurring work that runs itself")
        for name in ("Log in", "Try the sample form", "Get started"):
            vis(pg.get_by_role("link", name=name, exact=True).first)
        pg.evaluate("() => window.scrollTo(0, 600)")
        assert pg.evaluate("() => window.scrollY") > 0
        until(pg, f"() => {{ const b = ({TOP_BAR_JS})(); return b.heights.length === 1 && b.shadow; }}", seconds=10)
        bar = pg.evaluate(TOP_BAR_JS)
        assert bar["heights"] == [TOP_BAR_PX] and bar["strays"] == 0, bar
        pg.evaluate("() => window.scrollTo(0, 0)")
        for name in ("Work", "Teams", "Learn"):
            btn = pg.get_by_role("button", name=name, exact=True)
            before = pg.get_by_role("link").count()
            click(btn)
            eventually(lambda: pg.get_by_role("link").count() > before, f"{name} menu panel links")
            pg.keyboard.press("Escape")
            foc(btn)
            eventually(lambda: pg.get_by_role("link").count() == before, f"{name} menu closed")


def test_welcome_team_kind_chips(browser, app_url):
    kinds = {"Office ops": ("Month-end close that starts itself", "Checklists repeat on the right day and every sign-off is recorded."),
             "Content": ("Every issue moves on its own schedule", "Briefs, drafts and reviews repeat each cycle and rules hand them on."),
             "Client work": ("Requests become tracked jobs", "A public form turns each request into a task with a named approver."),
             "Facilities": ("Upkeep that never lapses", "Machine and building checks come back every week or month."),
             "Finance close": ("Approvals with a clear paper trail", "Each decision is saved with who agreed and when."),
             "Studio": ("A balanced week for every person", "Daily workload shows who is over capacity before a deadline slips.")}
    with open_app(browser, app_url + "/") as pg:
        tabs = pg.get_by_role("tablist", name="Team kinds")
        for name, (heading, copy) in kinds.items():
            tab = tabs.get_by_role("tab", name=name, exact=True)
            click(tab)
            attr(tab, "aria-selected", "true")
            vis(pg.get_by_role("heading", level=2, name=heading, exact=True))
            vis(pg.get_by_text(copy, exact=True))
            assert tab.bounding_box()["height"] >= TAP_MIN_PX - 1
        idle = tabs.get_by_role("tab", name="Office ops", exact=True)
        rest, hover = state_styles(idle, "background-color", state="hover")
        assert rest != hover


def test_welcome_signup_block(browser, app_url):
    email = f"visitor.{uid()}@example.test"
    with open_app(browser, app_url + "/") as pg:
        block = (pg.locator("*")
                 .filter(has=pg.get_by_role("textbox", name="Work email", exact=True))
                 .filter(has=pg.get_by_text("Join with a team code", exact=True))
                 .filter(has=pg.get_by_text("Open a sample request form", exact=True))
                 .filter(has_not=pg.get_by_role("banner"))
                 .filter(has_not=pg.get_by_role("contentinfo"))
                 .last)
        vis(block.get_by_text("Join with a team code", exact=True).first)
        vis(block.get_by_text("Open a sample request form", exact=True).first)
        box = pg.get_by_role("textbox", name="Work email", exact=True)
        rest, ring = state_styles(box, "outline-width", "box-shadow", state="focus")
        assert rest != ring
        fill(box, email)
        click(pg.get_by_role("button", name="Sign up", exact=True))
        pg.wait_for_url(re.compile(r"/account"))
        assert pg.get_by_label("Email", exact=True).input_value() == email


def test_welcome_collage_swap(browser, app_url):
    for reduced in ("reduce", "no-preference"):
        with open_app(browser, app_url + "/", reduced_motion=reduced) as pg:
            tab = pg.get_by_role("tablist", name="Team kinds").get_by_role("tab", name="Studio", exact=True)
            click(tab)
            attr(tab, "aria-selected", "true")
            heading = pg.get_by_role("heading", level=2, name="A balanced week for every person", exact=True)
            vis(heading)
            if reduced == "reduce":
                assert animations(heading) == []


def test_welcome_showcase_and_round_buttons(browser, app_url):
    with open_app(browser, app_url + "/") as pg:
        tabs = pg.get_by_role("tablist", name="Showcase views")
        for name in ("List", "Board", "Timeline", "Workload", "Rules"):
            tab = tabs.get_by_role("tab", name=name, exact=True)
            click(tab)
            attr(tab, "aria-selected", "true")
        assert tabs.get_by_role("tab").count() == 5


def test_welcome_layout_and_footer(browser, app_url):
    for size in (DESKTOP, TABLET, PHONE):
        with open_app(browser, app_url + "/") as pg:
            pg.set_viewport_size(size)
            pg.reload()
            vis(pg.get_by_role("heading", level=1))
            layout(pg)
            box = pg.get_by_role("textbox", name="Work email", exact=True).bounding_box()
            if size == DESKTOP:
                assert box["x"] + box["width"] / 2 < size["width"] / 2
            if size == PHONE:
                row = pg.get_by_role("tablist", name="Team kinds")
                assert row.evaluate("""e => { for (let p = e; p && p !== document.body; p = p.parentElement) {
                    const ox = getComputedStyle(p).overflowX;
                    if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true; }
                    return false; }""")
            vis(pg.get_by_text("Start your workspace", exact=True).first)
            back = pg.get_by_role("button", name="Back to top", exact=True)
            back.scroll_into_view_if_needed()
            click(back)
            eventually(lambda: pg.evaluate("() => window.scrollY") == 0 or advance(pg, 400) or pg.evaluate("() => window.scrollY") == 0, "scrolled to top")


def test_signup_verify_join_api(app_url, mail):
    w = world(app_url)
    n = uid()
    email = f"new.{n}@example.test"
    good = {"name": "New Person", "email": email, "password": "longenough1"}
    for bad, field, msg in (({**good, "name": ""}, "name", "Enter your name"),
                            ({**good, "email": "nope"}, "email", "Enter an email address like name@example.com"),
                            ({**good, "password": "short"}, "password", "Use at least 8 characters")):
        r = post_json(app_url, "/api/signup", bad)
        assert r.status_code == 422 and r.json()["errors"][field] == msg
    r = post_json(app_url, "/api/signup", good)
    assert r.status_code == 201 and r.json()["verified"] is False
    r2 = post_json(app_url, "/api/signup", good)
    assert r2.status_code == 422 and r2.json()["errors"]["email"] == "That email already has an account"
    msgs = mail_for(mail, email)
    assert len(msgs) == 1 and msgs[0]["Subject"] == "Your Everyweek verification code"
    assert mail_from_address() in [a.lower() for a in addresses(msgs[0].get("From"))]
    codes = set(re.findall(r"(?<!\d)\d{6}(?!\d)", text(msgs[0])))
    assert len(codes) == 1
    code = codes.pop()
    c = client(app_url, email) if False else httpx.Client(base_url=app_url, timeout=HTTP_S)
    assert c.post("/api/signin", json={"email": email, "password": "longenough1"}).status_code == 200
    r = c.post("/api/teams/join", json={"code": f"JOIN-{w.n}"})
    assert (r.status_code, r.json()) == (403, {"error": "not_verified"})
    wrong = "000000" if code != "000000" else "111111"
    r = post_json(app_url, "/api/verify", {"email": email, "code": wrong})
    assert r.status_code == 422 and r.json()["errors"]["code"] == "That code is not right"
    assert post_json(app_url, "/api/verify", {"email": f"ghost.{n}@example.test", "code": code}).status_code == 404
    r = post_json(app_url, "/api/verify", {"email": email, "code": code})
    assert (r.status_code, r.json()) == (200, {"verified": True})
    assert c.post("/api/teams/join", json={"code": "NO-SUCH-" + n}).status_code == 404
    r = c.post("/api/teams/join", json={"code": f"JOIN-{w.n}"})
    assert r.status_code == 200 and r.json() == {"teamId": w.team, "name": w.team_name}
    me = c.get("/api/me").json()
    assert me["verified"] is True and any(t["id"] == w.team for t in me["teams"])


def test_wf_W01_add_and_select(browser, app_url):
    w = world(app_url, fields=[TAGS], tasks=[T("e", "Existing")])
    names = ["Order dry goods", "Pack orders", "Count freezer"]
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        entry = pg.get_by_role("textbox", name="Add task").first
        for nm in names:
            fill(entry, nm)
            pg.keyboard.press("Enter")
            vis(ob(pg, nm))
            foc(entry)
            expect(entry).to_have_value("")
        ys = [ob(pg, nm).bounding_box()["y"] for nm in names]
        assert ys == sorted(ys)
        eventually(lambda: [t["name"] for t in all_tasks(c, w.project) if t["name"] in names] == names, "tasks saved in typed order")
        ob(pg, names[0]).focus()
        press(pg, "Shift+ArrowDown", "Shift+ArrowDown")
        expect(pg.get_by_role("row", selected=True)).to_have_count(3, timeout=LIVE_WAIT_MS)
        assert active_in(pg.get_by_role("grid", name="Tasks"))
        pg.keyboard.press("ArrowDown")
        expect(pg.get_by_role("row", selected=True)).to_have_count(0, timeout=LIVE_WAIT_MS)
        assert active_in(pg.get_by_role("grid", name="Tasks"))


def test_wf_W01_indent_tags_live(browser, app_url):
    w = world(app_url, fields=[TAGS], tasks=[T("a", "Order dry goods"), T("b", "Pack orders"), T("c", "Count freezer")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg, \
            view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        vis(ob(other, "Pack orders"))
        ob(pg, "Order dry goods").focus()
        press(pg, "Shift+ArrowDown", "Shift+ArrowDown")
        btn = pg.get_by_role("button", name="Set Tags for selection", exact=True)
        click(btn)
        dlg = pg.get_by_role("dialog", name="Set Tags", exact=True)
        check(dlg.get_by_role("checkbox", name="Fresh", exact=True))
        click(dlg.get_by_role("button", name="Apply tags", exact=True))
        foc(btn)
        eventually(lambda: all(get_task(c, w.tasks[k])["values"].get("Tags") == ["Fresh"] for k in "abc"), "Tags saved on all three tasks")
        expect(other.get_by_role("row").filter(has_text="Pack orders")).to_contain_text("Fresh", timeout=LIVE_WAIT_MS)
        pg.reload()
        ob(pg, "Pack orders").focus()
        pg.keyboard.press("Control+]")
        eventually(lambda: get_task(c, w.tasks["b"])["parentId"] == w.tasks["a"], "Pack orders saved as subtask of Order dry goods")
        attr(other.get_by_role("row").filter(has_text="Pack orders"), "aria-level", "2")


def test_list_nesting_rules_api(app_url):
    w = world(app_url, tasks=[T("x", "X"), T("a", "A"), T("b", "B"), T("c", "C"), T("d", "D", "Doing")])
    c = client(app_url, w.who["noor"].email)
    t = w.tasks
    assert patch(c, t["b"], parentId=t["a"]).status_code == 200
    assert patch(c, t["c"], parentId=t["a"]).status_code == 200
    tc = get_task(c, t["c"])
    assert tc["parentId"] == t["a"] and tc["position"] == 2
    refuse = {"errors": {"parentId": "Tasks nest one level only"}}
    for tid, parent in ((t["a"], t["x"]), (t["b"], t["c"]), (t["d"], t["a"])):
        r = patch(c, tid, parentId=parent)
        assert (r.status_code, r.json()) == (422, refuse), tid
    r = patch(c, t["x"], parentId=None)
    assert (r.status_code, r.json()) == (422, refuse)
    assert patch(c, t["b"], parentId=None).status_code == 200
    listed = [(x["name"], x["parentId"], x["position"]) for x in all_tasks(c, w.project) if x["name"] in "XABC"]
    assert listed == [("X", None, 1), ("A", None, 2), ("C", t["a"], 1), ("B", None, 3)]
    r = patch(c, t["x"], values={"Tags": ["Fresh", "Dry"]})
    assert r.status_code in (200, 422)


def test_wf_W01_announcements(browser, app_url):
    w = world(app_url, fields=[TAGS], tasks=[T("a", "Order dry goods"), T("b", "Pack orders"), T("c", "Count freezer")])
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        ls = st(pg, "List status")
        ob(pg, "Pack orders").focus()
        for key, msg in (("Control+]", "Pack orders is now a subtask of Order dry goods"), ("Control+]", "Can't indent Pack orders"),
                         ("Control+[", "Pack orders is no longer a subtask"), ("Control+[", "Can't outdent Pack orders")):
            pg.keyboard.press(key)
            has(ls, msg)
        ob(pg, "Order dry goods").focus()
        press(pg, "Shift+ArrowDown", "Shift+ArrowDown")
        has(ls, "3 tasks selected")
        click(pg.get_by_role("button", name="Set Tags for selection", exact=True))
        dlg = pg.get_by_role("dialog", name="Set Tags", exact=True)
        check(dlg.get_by_role("checkbox", name="Dry", exact=True))
        click(dlg.get_by_role("button", name="Apply tags", exact=True))
        has(ls, "Tags set on 3 tasks")


CANDIDATE_JS = """({id, name}) => {
  const label = e => e ? (e.getAttribute('aria-label') || e.textContent || '').trim() : '';
  const hit = e => !!e && (e.getAttribute('data-task') === id || label(e).startsWith(name + ','));
  const a = document.activeElement;
  if (hit(a) || hit(a && a.closest('[data-task]'))) return true;
  const ad = a && a.getAttribute('aria-activedescendant');
  if (ad && hit(document.getElementById(ad))) return true;
  const bar = [...document.querySelectorAll(`[data-task="${id}"][data-start]`)];
  if (bar.some(b => ['aria-current', 'aria-selected', 'aria-checked'].some(k => { const v = b.getAttribute(k); return v && v !== 'false'; }))) return true;
  const named = s => (s.getAttribute('aria-label') || (s.getAttribute('aria-labelledby') || '').split(/\\s+/)
    .map(i => (document.getElementById(i) || {}).textContent || '').join(' ')).trim() === 'Timeline status';
  return [...document.querySelectorAll('[role=status]')].some(s => named(s) && (s.textContent || '').includes(name));
}"""


def board_world(base):
    return world(base, tasks=[T("a", "Order dry goods"), T("b", "Pack orders"), T("c", "Count freezer"), T("d", "Weigh stock", "Doing")])


def test_wf_W02_keyboard_move(browser, app_url):
    w = board_world(app_url)
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=board") as pg:
        bs = st(pg, "Board status")
        card(pg, "Order dry goods", "To do", 1, 3).focus()
        for key, msg in (("Space", "Picked up Order dry goods. To do, position 1 of 3."), ("ArrowRight", "Order dry goods, Doing, position 1 of 2."),
                         ("ArrowDown", "Order dry goods, Doing, position 2 of 2."), ("Space", "Dropped Order dry goods in Doing, position 2 of 2.")):
            pg.keyboard.press(key)
            has(bs, msg)
        eventually(lambda: get_task(c, w.tasks["a"])["section"] == w.sections["Doing"] and get_task(c, w.tasks["a"])["position"] == 2, "drop saved")
        card(pg, "Pack orders", "To do", 1, 2).focus()
        press(pg, "Space", "ArrowRight")
        pg.keyboard.press("Escape")
        has(bs, "Move cancelled. Pack orders is back in To do, position 1 of 2.")
        assert get_task(c, w.tasks["b"])["section"] == w.sections["To do"]


def test_wf_W02_pointer_drag(browser, app_url):
    w = board_world(app_url)
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=board") as pg, \
            view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}?view=board") as other:
        src = card(pg, "Order dry goods", "To do", 1, 3)
        vis(card(other, "Order dry goods", "To do", 1, 3))
        x, y = center(src)
        tx, ty = center(pg.get_by_role("group", name="Doing", exact=True))
        pg.mouse.move(x, y)
        pg.mouse.down()
        pg.mouse.move(x + 20, y + 20, steps=4)
        pg.mouse.move(tx, ty, steps=10)
        pg.mouse.up()
        eventually(lambda: get_task(c, w.tasks["a"])["section"] == w.sections["Doing"], "dragged card saved in Doing")
        mine = re.compile(r"^Order dry goods, Doing, position \d of 2$")
        vis(other.get_by_role("group", name="Doing", exact=True).get_by_role("button", name=mine))
        pg.reload()
        vis(pg.get_by_role("group", name="Doing", exact=True).get_by_role("button", name=mine))


MOVE_MS = 320
FRAME_MS = 16


def eased(x):
    lo, hi = 0.0, 1.0
    for _ in range(60):
        t = (lo + hi) / 2
        lo, hi = (t, hi) if 3 * 0.2 * (1 - t) ** 2 * t + t ** 3 < x else (lo, t)
    t = (lo + hi) / 2
    return 3 * (1 - t) * t ** 2 + t ** 3


def test_wf_W02_move_motion(browser, app_url):
    for reduced in ("no-preference", "reduce"):
        w = board_world(app_url)
        with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=board", reduced=reduced) as pg:
            card(pg, "Order dry goods", "To do", 1, 3).focus()
            press(pg, "Space", "ArrowRight", "Space")
            moved = card(pg, "Order dry goods", "Doing", 1, 2)
            vis(moved)
            if reduced == "reduce":
                attr(moved, "data-move-progress", "1.0000")
                attr(moved, "data-motion", "settled")
                continue
            assert moved.get_attribute("data-motion") == "moving"
            for at, want in ((80, "0.6072"), (160, "0.8778"), (240, "0.9755")):
                advance(pg, 80)
                got = moved.get_attribute("data-move-progress") or ""
                low = eased((at - FRAME_MS) / MOVE_MS) - 0.0001
                assert re.fullmatch(r"[01]\.\d{4}", got) and low <= float(got) <= float(want) + 0.0001, (at, got, want)
            advance(pg, 80)
            advance(pg, 16)
            attr(moved, "data-move-progress", "1.0000")
            attr(moved, "data-motion", "settled")


def test_wf_W03_shift_bar(browser, app_url):
    w = world(app_url, tasks=[T("a", "Order dry goods", start="2026-03-02", due="2026-03-04"), T("x", "Pack orders", start="2026-03-09", due="2026-03-09")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=timeline") as pg:
        ts = st(pg, "Timeline status")
        pg.get_by_role("button", name="Order dry goods, 2026-03-02 to 2026-03-04", exact=True).focus()
        pg.keyboard.press("ArrowRight")
        has(ts, "Order dry goods moved to 2026-03-03 to 2026-03-05")
        eventually(lambda: (get_task(c, w.tasks["a"])["start"], get_task(c, w.tasks["a"])["due"]) == ("2026-03-03", "2026-03-05"), "both dates saved")
        pg.keyboard.press("Shift+ArrowRight")
        has(ts, "Order dry goods now due 2026-03-06")
        eventually(lambda: (get_task(c, w.tasks["a"])["start"], get_task(c, w.tasks["a"])["due"]) == ("2026-03-03", "2026-03-06"), "only due saved")
        pg.get_by_role("button", name="Pack orders, 2026-03-09 to 2026-03-09", exact=True).focus()
        pg.keyboard.press("Shift+ArrowLeft")
        has(ts, "Due date can't be before the start date")
        assert get_task(c, w.tasks["x"])["due"] == "2026-03-09"


def test_wf_W03_dependency(browser, app_url):
    w = world(app_url, tasks=[T("a", "Order dry goods", start="2026-03-02", due="2026-03-04"), T("b", "Pack orders", start="2026-03-03", due="2026-03-06"),
                              T("c", "Count freezer", start="2026-03-10", due="2026-03-11")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=timeline") as pg, \
            view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}?view=timeline") as other:
        ts = st(pg, "Timeline status")
        vis(other.get_by_role("button", name="Pack orders, 2026-03-03 to 2026-03-06", exact=True))
        pg.get_by_role("button", name="Order dry goods, 2026-03-02 to 2026-03-04", exact=True).focus()
        pg.keyboard.press("d")
        has(ts, "Choose the task that waits for Order dry goods")
        pg.keyboard.press("Escape")
        has(ts, "Dependency cancelled")
        pg.keyboard.press("d")
        has(ts, "Choose the task that waits for Order dry goods")
        picked = lambda: pg.evaluate(CANDIDATE_JS, {"id": w.tasks["b"], "name": "Pack orders"})
        found = picked()
        for key in ("ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"):
            for _ in range(3):
                if found:
                    break
                pg.keyboard.press(key)
                found = picked()
        assert found, "no arrow key made Pack orders the dependency candidate"
        pg.keyboard.press("Enter")
        has(ts, "Order dry goods now blocks Pack orders")
        eventually(lambda: get_task(c, w.tasks["a"])["blocks"] == [w.tasks["b"]] and get_task(c, w.tasks["b"])["blockedBy"] == [w.tasks["a"]], "dependency saved")
        vis(other.locator(f'[data-from="{w.tasks["a"]}"][data-to="{w.tasks["b"]}"]'))
        vis(other.get_by_text("Starts before Order dry goods is due", exact=True))
        assert c.post(f"/api/tasks/{w.tasks['a']}/dependencies", json={"blocks": w.tasks["c"]}).status_code == 201
        vis(other.locator(f'[data-from="{w.tasks["a"]}"][data-to="{w.tasks["c"]}"]'))
        expect(other.get_by_text("Starts before Order dry goods is due")).to_have_count(1)
        r = c.post(f"/api/tasks/{w.tasks['a']}/dependencies", json={"blocks": w.tasks["a"]})
        assert (r.status_code, r.json()) == (422, {"errors": {"blocks": "A task can't block itself or create a loop"}})


def test_wf_W03_bar_attributes(browser, app_url):
    w = world(app_url, tasks=[T("s", "Order dry goods", start="2026-03-02", due="2026-03-04"), T("d", "Pack orders", due="2026-03-06"),
                              T("u", "Count freezer", start="2026-03-05"), T("n", "Weigh stock")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=timeline") as pg:
        bar = pg.get_by_role("button", name="Order dry goods, 2026-03-02 to 2026-03-04", exact=True)
        vis(bar)
        assert (bar.get_attribute("data-task"), bar.get_attribute("data-start"), bar.get_attribute("data-due")) == (w.tasks["s"], "2026-03-02", "2026-03-04")
        one = pg.get_by_role("button", name="Pack orders, 2026-03-06 to 2026-03-06", exact=True)
        vis(one)
        assert one.get_attribute("data-start") == one.get_attribute("data-due") == "2026-03-06"
        vis(pg.get_by_text("Unscheduled", exact=True))
        for nm in ("Count freezer", "Weigh stock"):
            vis(pg.get_by_text(nm).first)
            gone(pg.get_by_role("button", name=re.compile(f"^{nm}, ")))
        one.focus()
        pg.keyboard.press("ArrowRight")
        nxt = (date.fromisoformat("2026-03-06") + timedelta(days=1)).isoformat()
        moved = pg.get_by_role("button", name=f"Pack orders, {nxt} to {nxt}", exact=True)
        vis(moved)
        assert moved.get_attribute("data-start") == moved.get_attribute("data-due") == nxt
        eventually(lambda: (get_task(c, w.tasks["d"])["start"], get_task(c, w.tasks["d"])["due"]) == (nxt, nxt), "both dates saved")


def test_wf_W04_formula_editor(browser, app_url):
    w = world(app_url, fields=[F("rate", "Rate", "number"), F("cost", "Cost", "formula", formula="{Effort} * {Rate}")],
              tasks=[T("a", "Alpha", effort=2, values={"Rate": 40})])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        hdr = pg.get_by_role("button", name="Edit formula for Cost", exact=True)
        hdr.focus()
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name="Edit formula: Cost", exact=True)
        vis(dlg)
        box = dlg.get_by_role("textbox", name="Formula", exact=True)
        foc(box)
        press(pg, "Control+A")
        pg.keyboard.type("{")
        vis(dlg.get_by_role("listbox", name="Field suggestions"))
        press(pg, "ArrowDown", "Enter")
        text_now = box.input_value()
        assert re.search(r"\{[^{}]+\}", text_now)
        mk(c, w.project, "Count freezer")
        eventually(lambda: pg.get_by_text("Count freezer").count() > 0, "live row arrived")
        assert box.input_value() == text_now and active_in(dlg)
        for _ in range(10):
            pg.keyboard.press("Tab")
            assert active_in(dlg)
        for _ in range(10):
            pg.keyboard.press("Shift+Tab")
            assert active_in(dlg)
        pg.keyboard.press("Escape")
        gone(dlg)
        foc(hdr)
        hdr.focus()
        pg.keyboard.press("Enter")
        vis(dlg)
        box.focus()
        press(pg, "Control+A")
        pg.keyboard.type("2 + * 3")
        click(dlg.get_by_role("button", name="Save formula", exact=True))
        has(dlg.get_by_role("alert"), "Formula error at character 5: expected a value")
        vis(dlg)
        fill(box, "{Effort} * {Rate} * 2")
        click(dlg.get_by_role("button", name="Save formula", exact=True))
        gone(dlg)
        vis(pg.get_by_label("Cost, 160", exact=True))
        focus_kept(pg, "Save formula")


def test_wf_W04_formula_values(app_url):
    fl = [F("rate", "Rate", "number"), F("extra", "Extra", "number"),
          F("f1", "Cost", "formula", formula="{Effort} * {Rate}"), F("f2", "Spread", "formula", formula="ROUND({Effort} / 3, 2)"),
          F("f3", "Days", "formula", formula="DAYS({Start}, {Due})"), F("f4", "Later", "formula", formula="{Due} + 3"),
          F("f5", "Size", "formula", formula='IF({Effort} > 4, "Large", "Small")'), F("f6", "Sum", "formula", formula="{Effort} + {Extra}"),
          F("f7", "Per", "formula", formula="{Rate} / 0"), F("f8", "Up", "formula", formula="ROUND(2.5, 0)"),
          F("f9", "Down", "formula", formula="ROUND(-2.5, 0)"), F("f10", "Cat", "formula", formula='CONCAT("a", {Extra}, "b")'),
          F("f11", "Blank", "formula", formula="ISBLANK({Extra})"), F("f12", "Txt", "formula", formula='"a" * 2')]
    w = world(app_url, fields=fl, tasks=[T("t1", "One", effort=2.5, start="2026-03-02", due="2026-03-09", values={"Rate": 40}),
                                         T("t2", "Two", values={"Rate": 40}), T("t3", "Three", effort=2), T("t4", "Four", effort=5)])
    c = client(app_url, w.who["noor"].email)
    v1 = get_task(c, w.tasks["t1"])["values"]
    assert (v1["Cost"], v1["Days"], v1["Later"], v1["Size"], v1["Sum"], v1["Per"]) == (100, 7, "2026-03-12", "Small", 2.5, "#DIV/0")
    assert (v1["Up"], v1["Down"], v1["Cat"], v1["Blank"], v1["Txt"]) == (3, -3, "ab", True, "#VALUE")
    v2 = get_task(c, w.tasks["t2"])["values"]
    assert v2["Cost"] is None and v2["Size"] == "Small" and v2["Sum"] == 0
    assert get_task(c, w.tasks["t3"])["values"]["Spread"] == 0.67
    assert get_task(c, w.tasks["t4"])["values"]["Size"] == "Large"


def test_wf_W04_formula_live(browser, app_url):
    w = world(app_url, fields=[F("rate", "Rate", "number"), F("cost", "Cost", "formula", formula="{Effort} * {Rate}")],
              tasks=[T("a", "Alpha", effort=2.5, values={"Rate": 40})])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        vis(pg.get_by_label("Cost, 100", exact=True))
        assert patch(c, w.tasks["a"], effort=4).status_code == 200
        vis(pg.get_by_label("Cost, 160", exact=True))
        assert patch(c, w.tasks["a"], effort=None).status_code == 200
        vis(pg.get_by_label("Cost, blank", exact=True))


def test_wf_W04_formula_errors_bounds(app_url):
    w = world(app_url, fields=[F("calc", "Calc", "formula", formula="1"), F("x", "X", "formula", formula="2"),
                               F("a1", "A1", "formula", formula="+".join(["{Effort}"] * 20)),
                               F("b2", "B2", "formula", formula="+".join(["{A1}"] * 40))], tasks=[T("t", "Alpha", effort=1)])
    c = client(app_url, w.who["noor"].email)
    fid = w.fields["calc"]
    cases = [("ROUND({Effort}, )", "Formula error at character 17: expected a value"), ("2 + * 3", "Formula error at character 5: expected a value"),
             ("ROUND({Effort}, 2", "Formula error at character 18: expected )"), ("{Effrot} + 1", "Formula error at character 1: unknown field Effrot"),
             ('IF({Effort} > 4, "Large")', "Formula error at character 1: IF needs 3 arguments"), ("", "Formula error at character 1: expected a value"),
             ("+" * 201, "Formula error at character 201: formula is longer than 200 characters"),
             ("{Calc} + 1", "Formula error at character 1: circular reference to Calc")]
    for formula, msg in cases:
        r = c.patch(f"/api/fields/{fid}", json={"formula": formula})
        assert r.status_code == 422 and r.json() == {"errors": {"formula": msg}}, formula
    assert next(f for f in c.get(f"/api/projects/{w.project}").json()["fields"] if f["id"] == fid)["formula"] == "1"
    assert c.patch(f"/api/fields/{w.fields['x']}", json={"formula": "{Calc}"}).status_code == 200
    r = c.patch(f"/api/fields/{fid}", json={"formula": "1 + {X}"})
    assert r.json()["errors"]["formula"] == "Formula error at character 5: circular reference to X"
    assert c.patch(f"/api/fields/{fid}", json={"formula": '"' + "a" * 198 + '"'}).status_code == 200
    t0 = time.monotonic()
    v = get_task(c, w.tasks["t"])["values"]
    assert v["A1"] == 20 and v["B2"] == "#BUDGET" and time.monotonic() - t0 < 2


def test_wf_W05_rule_builder_keyboard(browser, app_url):
    w = world(app_url, sections=("To do", "Review"), fields=[F("stage", "Stage", "single_select", options=["Draft", "Ready", "Review"])])
    c = client(app_url, w.who["noor"].email)
    name = "Ready to review"
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}/rules") as pg:
        pg.get_by_role("button", name="New rule", exact=True).focus()
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name="New rule", exact=True)
        vis(dlg)
        save = dlg.get_by_role("button", name="Save rule", exact=True)
        save.focus()
        pg.keyboard.press("Enter")
        vis(dlg.get_by_text("Enter a rule name", exact=True))
        for step, msg in (("Step 1: When", "Choose when the rule runs"), ("Step 3: Then", "Choose what happens")):
            err = dlg.get_by_text(msg, exact=True)
            if not err.is_visible():
                dlg.get_by_role("button", name=step, exact=True).focus()
                pg.keyboard.press("Enter")
            vis(err)
        box = dlg.get_by_role("textbox", name="Rule name", exact=True)
        box.focus()
        pg.keyboard.type(name)
        when, then = dlg.get_by_role("combobox", name="When", exact=True), dlg.get_by_role("combobox", name="Then", exact=True)
        dlg.get_by_role("button", name="Step 1: When", exact=True).focus()
        pg.keyboard.press("Enter")
        vis(when)
        gone(then)
        choose(when, "Task added")
        dlg.get_by_role("button", name="Step 3: Then", exact=True).focus()
        pg.keyboard.press("Space")
        vis(then)
        gone(when)
        choose(then, "Send to inbox")
        mk(c, w.project, "Live row")
        assert box.input_value() == name and active_in(dlg)
        save.focus()
        pg.keyboard.press("Enter")
        has(st(pg, "Rules status"), f"Rule saved: {name}")
    rules = c.get(f"/api/projects/{w.project}/rules").json()["rules"]
    mine = next(r for r in rules if r["name"] == name)
    assert mine["trigger"]["type"] == "task_added" and mine["action"]["type"] == "send_to_inbox"


def test_wf_W05_recipe_carousel(browser, app_url):
    w = world(app_url, sections=("To do", "Review"))
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}/rules") as pg:
        region = pg.get_by_role("region", name="Rule recipes")
        vis(region)
        click(region.get_by_role("button", name=re.compile(r"^Use recipe: ")).first)
        dlg = pg.get_by_role("dialog", name="New rule", exact=True)
        vis(dlg)
        click(dlg.get_by_role("button", name="Step 1: When", exact=True))
        assert shown(dlg.get_by_role("combobox", name="When", exact=True)) != ""
        click(dlg.get_by_role("button", name="Cancel", exact=True))
        gone(dlg)
        prev, nxt = region.get_by_role("button", name="Previous recipes", exact=True), region.get_by_role("button", name="Next recipes", exact=True)
        expect(prev).to_be_disabled()
        expect(nxt).to_be_enabled()
        assert float(style(prev, "opacity")["opacity"]) < float(style(nxt, "opacity")["opacity"])
        for b in (prev, nxt):
            box = b.bounding_box()
            assert min(box["width"], box["height"]) >= TAP_MIN_PX - 1
        click(nxt)
        expect(prev).to_be_enabled(timeout=LIVE_WAIT_MS)


def test_wf_W05_once_across_instances(app_url, down_url):
    w = world(app_url, fields=[F("stage", "Stage", "single_select", options=["Draft", "Ready"]), F("prio", "Priority", "single_select", options=["Low", "High"])],
              tasks=[T("t", "Due job", due="2032-02-10")],
              rules=[{"key": "second", "name": "Second", "position": 2, "trigger": {"type": "due_date_arrives"}, "action": {"type": "set_field", "target": "prio", "value": "High"}},
                     {"key": "first", "name": "First", "position": 1, "trigger": {"type": "due_date_arrives"}, "action": {"type": "set_field", "target": "stage", "value": "Ready"}}])
    c = client(app_url, w.who["noor"].email)
    clock(app_url, "2032-02-09T12:00:00Z")
    assert runs(c, w.tasks["t"]) == []
    ts = [threading.Thread(target=clock, args=(b, "2032-02-10T00:30:00Z")) for b in (app_url, down_url)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    got = eventually(lambda: [r["summary"] for r in runs(c, w.tasks["t"])], "rule runs recorded")
    assert got == ["First ran: set Stage to Ready", "Second ran: set Priority to High"]


def test_wf_W05_chain_depth(app_url):
    w = chain_world(app_url)
    c = client(app_url, w.who["noor"].email)
    r = patch(c, w.tasks["t"], values={"Stage": "Ready"})
    assert r.status_code == 200
    done = r.json()
    assert done["section"] == w.sections["Review"] and done["assigneeId"] == w.who["noor"].id and done["values"]["Priority"] == "High"
    entries = runs(c, w.tasks["t"])
    assert [e["summary"] for e in entries] == ["Ready to review ran: moved to Review", f"Review sets owner ran: assigned to {w.who['noor'].name}",
                                               "Owner flags ran: set Priority to High", "Stopped: chain depth limit 3 reached at High priority notice"]
    assert [e["depth"] for e in entries] == [1, 2, 3, 4]
    assert entries[0]["detail"] == "Trigger: Field changed Stage to Ready. Conditions: none"
    assert entries[3]["detail"] == "Trigger: Field changed Priority to High. Not run: depth 4 is deeper than 3"
    skipped = added_runs(c, mk(c, w.project, "Plain")["id"])
    assert (skipped[0]["summary"], skipped[0]["detail"]) == ("Gate skipped: conditions not met", "Trigger: Task added. Conditions: not met")
    hit = added_runs(c, mk(c, w.project, "Flagged", values={"Priority": "High"})["id"])
    stage, draft = "Stage", "Draft"
    assert hit[0]["summary"] == f"{GATE_RULE} ran: set {stage} to {draft}" and hit[0]["detail"] == "Trigger: Task added. Conditions: met"


def test_wf_W05_run_limit(app_url):
    clock(app_url, "2032-01-01T00:00:10Z")
    w = world(app_url, fields=[F("p", "Priority", "single_select", options=["Low", "High"])],
              rules=[{"key": "r", "name": "Count", "trigger": {"type": "task_added"}, "action": {"type": "set_field", "target": "p", "value": "Low"}}])
    c = client(app_url, w.who["noor"].email)
    made = [mk_ran(c, w.project, f"N{i}") for i in range(61)]
    assert added_runs(c, made[59]["id"])[-1]["summary"] == "Count ran: set Priority to Low"
    last = added_runs(c, made[60]["id"])
    assert last[-1]["summary"] == "Skipped: rule run limit 60 per minute reached"
    assert last[-1]["detail"] == "Trigger: Task added. Not run: 60 runs this minute"
    assert get_task(c, made[60]["id"])["values"].get("Priority") is None
    clock(app_url, "2032-01-01T00:01:10Z")
    assert added_runs(c, mk(c, w.project, "Next minute")["id"])[-1]["summary"] == "Count ran: set Priority to Low"


def test_wf_W05_runs_panel_live(browser, app_url):
    w = chain_world(app_url)
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg, \
            view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        click(ob(other, "Weigh stock"))
        vis(detail(other, "Weigh stock"))
        panel = detail(other, "Weigh stock").get_by_role("list", name="Rule runs")
        assert patch(c, w.tasks["t"], values={"Stage": "Ready"}).status_code == 200
        entries = panel.locator("[data-depth]")
        expect(entries).to_have_count(4, timeout=LIVE_WAIT_MS)
        assert entries.evaluate_all("els => els.map(e => e.getAttribute('data-depth'))") == ["1", "2", "3", "4"]
        assert entries.evaluate_all("els => els.map(e => e.querySelector('[data-part=summary]').textContent.trim())") == [
            "Ready to review ran: moved to Review", f"Review sets owner ran: assigned to {w.who['noor'].name}",
            "Owner flags ran: set Priority to High", "Stopped: chain depth limit 3 reached at High priority notice"]
        lefts = entries.evaluate_all("els => els.map(e => e.querySelector('[data-part=summary]').getBoundingClientRect().left)")
        assert all(abs((b - a) - 16) <= 1 for a, b in zip(lefts, lefts[1:]))


def test_wf_W06_repeat_rules(app_url):
    clock(app_url, "2026-03-04T10:00:00Z")
    w = world(app_url, fields=[F("rate", "Rate", "number")], tasks=[
        T("mon", "Mon job", start="2026-02-27", due="2026-03-02", effort=2.5, assignee="noor", recurrence="Every week on Monday", values={"Rate": 40}),
        T("fri", "Fri job", due="2026-03-02", recurrence="Every week on Friday"),
        T("mo", "Month job", due="2026-01-31", recurrence="Every month on day 31"),
        T("aft", "After job", due="2026-03-02", recurrence="Every 10 days after completion")])
    c = client(app_url, w.who["noor"].email)

    def complete(tid, name):
        assert patch(c, tid, completed=True).status_code == 200
        found = eventually(lambda: [t for t in all_tasks(c, w.project) if t["name"] == name and not t["completed"]], f"successor of {name}")
        assert len(found) == 1
        return found[0]
    s = complete(w.tasks["mon"], "Mon job")
    assert (s["due"], s["start"], s["effort"], s["assigneeId"], s["recurrence"], s["completed"], s["section"]) == (
        "2026-03-09", "2026-03-06", 2.5, w.who["noor"].id, "Every week on Monday", False, w.sections["To do"])
    assert s["values"]["Rate"] == 40
    assert complete(w.tasks["fri"], "Fri job")["due"] == "2026-03-06"
    m1 = complete(w.tasks["mo"], "Month job")
    assert m1["due"] == "2026-02-28"
    assert complete(m1["id"], "Month job")["due"] == "2026-03-31"
    assert complete(w.tasks["aft"], "After job")["due"] == "2026-03-14"


def test_wf_W06_clock_passes_due(app_url, down_url):
    clock(app_url, "2026-03-02T09:00:00Z")
    w = world(app_url, tasks=[T("y", "Y job", due="2026-03-02", recurrence="Every week on Monday")])
    c = client(app_url, w.who["noor"].email)
    dues = lambda: sorted(t["due"] for t in all_tasks(c, w.project) if t["name"] == "Y job")
    assert dues() == ["2026-03-02"]
    clock(app_url, "2026-03-20T09:00:00Z")
    assert dues() == ["2026-03-02", "2026-03-09"]
    clock(app_url, "2026-03-20T09:00:00Z")
    assert dues() == ["2026-03-02", "2026-03-09", "2026-03-16"]
    q = world(app_url, tasks=[T("q", "Q job", due="2026-03-02", recurrence="Every week on Monday")])
    clients = [client(app_url, q.who["noor"].email), client(down_url, q.who["noor"].email)]
    v = get_task(clients[0], q.tasks["q"])["version"]
    codes = []
    ts = [threading.Thread(target=lambda cl=cl: codes.append(cl.patch(f"/api/tasks/{q.tasks['q']}", json={"version": v, "completed": True}).status_code)) for cl in clients]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [200, 409]
    eventually(lambda: len([t for t in all_tasks(clients[0], q.project) if t["name"] == "Q job"]) == 2, "exactly one successor")


def test_wf_W06_complete_by_keyboard(browser, app_url):
    clock(app_url, "2026-03-04T10:00:00Z")
    w = world(app_url, tasks=[T("a", "Weigh stock", due="2026-03-02", effort=2.5, assignee="noor", recurrence="Every week on Monday")])
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg, \
            view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        vis(ob(other, "Weigh stock"))
        ob(pg, "Weigh stock").focus()
        pg.keyboard.press("Control+Enter")
        has(st(other, "List status"), "Weigh stock repeats on 2026-03-09")
        rows = other.locator('[role="row"][data-task]').filter(has_text="Weigh stock")
        eventually(lambda: [d for d in rows.evaluate_all("els => els.map(e => e.getAttribute('data-task'))") if d != w.tasks["a"]],
                   "the successor row in the teammate's list", seconds=LIVE_WAIT_MS / 1000)
        assert len([d for d in rows.evaluate_all("els => els.map(e => e.getAttribute('data-task'))") if d != w.tasks["a"]]) == 1
        assert active_in(pg.locator(f'[role="row"][data-task="{w.tasks["a"]}"]'))
        pg.keyboard.press("Control+Enter")
        has(st(pg, "List status"), re.compile(r"marked not complete|repeats on"))
        pg.clock.set_fixed_time("2040-06-01T12:00:00Z")
        pg.goto(app_url + "/")
        vis(pg.get_by_text("Later", exact=True).first)


def test_wf_W07_goal_rollup(app_url):
    g = goal_world(app_url)
    c = client(app_url, g.who["noor"].email)
    by = goals_by_name(c, g.team)
    n = g.names
    assert (by[n["kit"]]["progress"], by[n["kit"]]["percent"]) == (pytest.approx(66.25), 66)
    assert (by[n["upk"]]["progress"], by[n["upk"]]["percent"]) == (pytest.approx(65), 65)
    assert (by[n["root"]]["progress"], by[n["root"]]["percent"]) == (pytest.approx(65.8333, abs=0.001), 66)
    link = by[n["kit"]]["projects"][0]
    assert link["weight"] == 3 and link["progress"] == pytest.approx(75)
    assert c.patch(f"/api/goals/{g.ids['sup']}", json={"manualValue": 80}).status_code == 200
    by = goals_by_name(c, g.team)
    assert (by[n["kit"]]["progress"], by[n["kit"]]["percent"]) == (pytest.approx(76.25), 76)
    assert (by[n["root"]]["progress"], by[n["root"]]["percent"]) == (pytest.approx(72.5), 73)
    tasks = [t for t in all_tasks(c, g.res["projects"]["p1"]) if not t["completed"] and t["parentId"] is None]
    assert patch(c, tasks[0]["id"], completed=True).status_code == 200
    assert goals_by_name(c, g.team)[n["kit"]]["progress"] == pytest.approx((3 * 87.5 + 80) / 4)
    r = c.patch(f"/api/goals/{g.ids['sup']}", json={"weight": 11})
    assert r.status_code == 422 and r.json()["errors"]["weight"] == "Weight must be a whole number from 1 to 10"
    r = c.patch(f"/api/goals/{g.ids['sup']}", json={"manualValue": 101})
    assert r.json()["errors"]["manualValue"] == "Manual value must be from 0 to 100"
    m = client(app_url, g.who["ilse"].email)
    r = m.patch(f"/api/goals/{g.ids['sup']}", json={"manualValue": 10})
    assert (r.status_code, r.json()) == (403, {"error": "forbidden"})


def test_wf_W07_goal_tree_keyboard(browser, app_url):
    g = goal_world(app_url)
    n = g.names
    item = lambda p, key: p.get_by_role("treeitem", name=re.compile(rf"^{re.escape(n[key])}, \d+% complete"))
    with view(browser, app_url, g.who["noor"].email, "/goals") as pg, view(browser, app_url, g.who["ilse"].email, "/goals") as other:
        vis(pg.get_by_role("link", name=f"Open {n['root']}", exact=True))
        gone(pg.get_by_role("link", name=f"Open {n['kit']}", exact=True))
        pg.get_by_role("link", name=f"Open {n['root']}", exact=True).focus()
        eventually(lambda: pg.keyboard.press("Tab") or pg.evaluate("() => document.activeElement.getAttribute('role')") == "treeitem", "Tab reached the tree")
        foc(item(pg, "root"))
        pg.keyboard.press("ArrowDown")
        foc(item(pg, "kit"))
        pg.keyboard.press("ArrowRight")
        foc(item(pg, "sup"))
        pg.keyboard.press("ArrowLeft")
        foc(item(pg, "kit"))
        pg.keyboard.press("ArrowLeft")
        gone(item(pg, "sup"))
        press(pg, "ArrowRight", "ArrowRight")
        foc(item(pg, "sup"))
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name=f"Goal: {n['sup']}", exact=True)
        vis(dlg)
        fill(dlg.get_by_role("spinbutton", name="Manual value", exact=True), "80")
        click(dlg.get_by_role("button", name="Save goal", exact=True))
        vis(other.get_by_role("treeitem", name=f"{n['root']}, 73% complete"))
        vis(other.get_by_role("treeitem", name=f"{n['kit']}, 76% complete"))
        solo = f"Stock check {g.n}"
        c = client(app_url, g.who["noor"].email)
        assert c.post(f"/api/teams/{g.team}/goals", json={"name": solo, "manualValue": 40}).status_code == 201
        node = pg.get_by_role("treeitem", name=re.compile(rf"^{re.escape(solo)}, \d+% complete"))
        vis(node)
        node.focus()
        foc(node)
        pg.keyboard.press("Enter")
        dlg = pg.get_by_role("dialog", name=f"Goal: {solo}", exact=True)
        vis(dlg)
        fill(dlg.get_by_role("spinbutton", name="Manual value", exact=True), "55")
        click(dlg.get_by_role("button", name="Save goal", exact=True))
        gone(dlg)
        vis(pg.get_by_role("treeitem", name=f"{solo}, 55% complete"))
        focus_kept(pg, "Save goal")


def test_wf_W07_progress_bar_motion(browser, app_url):
    for reduced in ("no-preference", "reduce"):
        g = goal_world(app_url)
        c = client(app_url, g.who["noor"].email)
        with view(browser, app_url, g.who["noor"].email, "/goals", reduced=reduced) as pg:
            bar = pg.get_by_role("progressbar", name=f"{g.names['kit']} progress", exact=True)
            attr(bar, "data-shown-percent", "66.25")
            upk = pg.get_by_role("progressbar", name=f"{g.names['upk']} progress", exact=True)
            assert c.patch(f"/api/goals/{g.ids['spa']}", json={"manualValue": 92}).status_code == 200
            attr(upk, "aria-valuenow", "66")
            assert c.patch(f"/api/goals/{g.ids['sup']}", json={"manualValue": 80}).status_code == 200
            attr(bar, "aria-valuenow", "76")
            attr(bar, "aria-valuetext", "76% complete")
            if reduced == "reduce":
                attr(bar, "data-shown-percent", "76.25")
                continue
            assert bar.get_attribute("data-shown-percent") == "66.25"
            published = [66.25, 72.32, 75.03, 76.00]
            for i in range(3):
                advance(pg, 100)
                got = float(bar.get_attribute("data-shown-percent"))
                assert published[i] - 0.005 <= got <= (published[i + 1] if i < 3 else 76.25) + 0.005, (i, got)
            advance(pg, 100)
            assert bar.get_attribute("data-shown-percent") == "76.25"


def test_wf_W08_workload_cells(app_url):
    w = workload_world(app_url)
    noor, ilse = w.who["noor"], w.who["ilse"]
    c = client(app_url, noor.email)
    j, cells = cells_of(c, w, noor)
    assert len(j["days"]) == 10 and j["days"][0] == "2026-03-02"
    want = {"2026-03-02": "4 of 8 h", "2026-03-03": "4 of 8 h", "2026-03-04": "7.3 of 8 h", "2026-03-05": "3.3 of 8 h",
            "2026-03-06": "5.8 of 4 h, over capacity", "2026-03-09": "2.5 of 8 h"}
    assert {d: cells[d]["text"] for d in want} == want
    assert cells["2026-03-06"]["over"] is True and cells["2026-03-04"]["over"] is False and cells["2026-03-06"]["capacity"] == 4
    assert cells_of(c, w, noor, frm="2026-03-04")[0]["days"][0] == "2026-03-02"
    assert patch(c, w.tasks["b"], assigneeId=ilse.id).status_code == 200
    _, cells = cells_of(c, w, noor)
    assert (cells["2026-03-04"]["text"], cells["2026-03-05"]["text"], cells["2026-03-06"]["text"]) == ("4 of 8 h", "0 of 8 h", "2.5 of 4 h")
    assert cells_of(c, w, ilse)[1]["2026-03-04"]["text"] == "3.3 of 8 h"
    m = client(app_url, ilse.email)
    assert m.put(f"/api/teams/{w.team}/capacities", json={"personId": noor.id, "weekday": "mon", "hours": 2}).status_code == 403
    r = c.put(f"/api/teams/{w.team}/capacities", json={"personId": noor.id, "weekday": "sat", "hours": 2})
    assert r.status_code == 422 and r.json()["errors"]["weekday"] == "Choose a weekday from mon to fri"
    r = c.put(f"/api/teams/{w.team}/capacities", json={"personId": noor.id, "weekday": "mon", "hours": 25})
    assert r.json()["errors"]["hours"] == "Hours must be from 0 to 24"
    assert c.put(f"/api/teams/{w.team}/capacities", json={"personId": noor.id, "weekday": "mon", "hours": LOW_CAP}).status_code == 200
    assert cells_of(c, w, noor)[1]["2026-03-02"]["text"] == f"4 of {LOW_CAP} h, over capacity"


def test_wf_W08_reassign_dialog(browser, app_url):
    w = workload_world(app_url)
    noor, ilse = w.who["noor"], w.who["ilse"]
    path = f"/workload/{w.team}?from=2026-03-02"
    with view(browser, app_url, noor.email, path) as pg, view(browser, app_url, w.who["tomas"].email, path) as other:
        start = wcell(pg, noor, "2026-03-02")
        vis(start)
        start.focus()
        press(pg, "ArrowRight", "ArrowRight")
        target = wcell(pg, noor, "2026-03-04")
        foc(target)
        pg.keyboard.press("Enter")
        pop = pg.get_by_role("dialog", name=f"Tasks for {noor.name} on 2026-03-04", exact=True)
        vis(pop)
        pg.keyboard.press("Escape")
        gone(pop)
        foc(target)
        pg.keyboard.press("Enter")
        vis(pop)
        pop.get_by_role("button", name="Pack orders", exact=True).focus()
        pg.keyboard.press("r")
        dlg = pg.get_by_role("dialog", name="Reassign task", exact=True)
        vis(dlg)
        choose(dlg.get_by_role("combobox", name="Assignee", exact=True), ilse.name)
        click(dlg.get_by_role("button", name="Reassign", exact=True))
        has(st(pg, "Workload status"), f"Pack orders reassigned to {ilse.name}")
        for p in (pg, other):
            attr(wcell(p, noor, "2026-03-05"), "data-total", "0.00")
            attr(wcell(p, ilse, "2026-03-05"), "data-total", "3.33")


def test_wf_W08_reassign_drag(browser, app_url):
    w = workload_world(app_url)
    noor, ilse = w.who["noor"], w.who["ilse"]
    c = client(app_url, noor.email)
    path = f"/workload/{w.team}?from=2026-03-02"
    with view(browser, app_url, noor.email, path) as pg, view(browser, app_url, w.who["tomas"].email, path) as other:
        vis(wcell(other, ilse, "2026-03-04"))
        wcell(pg, noor, "2026-03-04").focus()
        pg.keyboard.press("Enter")
        chip = pg.get_by_role("dialog", name=f"Tasks for {noor.name} on 2026-03-04", exact=True).get_by_role("button", name="Pack orders", exact=True)
        vis(chip)
        x, y = center(chip)
        tx, ty = center(wcell(pg, ilse, "2026-03-04"))
        pg.mouse.move(x, y)
        pg.mouse.down()
        pg.mouse.move(x + 20, y + 20, steps=4)
        pg.mouse.move(tx, ty, steps=10)
        pg.mouse.up()
        eventually(lambda: get_task(c, w.tasks["b"])["assigneeId"] == ilse.id, "drag reassigned the task")
        has(st(pg, "Workload status"), f"Pack orders reassigned to {ilse.name}")
        attr(wcell(other, ilse, "2026-03-04"), "data-total", "3.33")


TAB_WALK_MAX = 60
TAB_STOP_JS = """() => {
  const e = document.activeElement;
  window.__tabSeen = window.__tabSeen || new Set();
  if (!e || e === document.body || e === document.documentElement) return 'body';
  // a native date or time input takes one Tab per segment while staying the active element: not a new stop
  if (e === window.__tabLast) return 'same';
  if (window.__tabSeen.has(e)) return null;
  window.__tabSeen.add(e);
  window.__tabLast = e;
  let s = false;
  for (let p = e; p; p = p.parentElement) { const q = getComputedStyle(p), w = p.getBoundingClientRect(); if (q.position === 'sticky' || (q.position === 'fixed' && Math.abs(w.top) <= 1 && w.width >= innerWidth - 1)) s = true; }
  const b = e.getBoundingClientRect();
  return [s, b.top, b.left, b.right, innerWidth];
}"""


def intake_world(base):
    slug = f"req-{uid()}"
    w = world(base, fields=[F("cat", "Category", "single_select", options=["Dry goods", "Fresh", "Equipment"])],
              forms=[{"key": "f", "slug": slug, "section": "To do", "title": "Supply request"}])
    return w, slug


def test_wf_W09_intake_errors(browser, app_url):
    clock(app_url, "2026-03-02T09:00:00Z")
    w, slug = intake_world(app_url)
    with view(browser, app_url, None, f"/f/{slug}") as pg:
        title = pg.get_by_role("textbox", name="Request title", exact=True)
        vis(title)
        click(pg.get_by_role("button", name="Submit request", exact=True))
        alert = pg.get_by_role("alert").filter(has=pg.get_by_role("heading", name="There is a problem", exact=True))
        vis(alert)
        eventually(lambda: active_in(alert), "focus moved into the error summary")
        for msg, field in (("Enter a request title", "Request title"), ("Enter a date today or later", "Needed by"),
                           ("Enter an email address like name@example.com", "Your email")):
            click(alert.get_by_role("link", name=msg, exact=True))
            foc(pg.get_by_role("textbox", name=field, exact=True))
        attr(title, "aria-invalid", "true")
        fill(title, "x" * 121)
        if len(title.input_value()) > 120:
            click(pg.get_by_role("button", name="Submit request", exact=True))
            vis(pg.get_by_text("Request title must be 120 characters or fewer", exact=True).first)
        else:
            assert len(title.input_value()) == 120
        fill(title, "Dry goods top-up")
        fill(pg.get_by_role("textbox", name="Needed by", exact=True), "2026-03-05")
        fill(pg.get_by_role("textbox", name="Your email", exact=True), f"req.{w.n}@example.test")
        click(pg.get_by_role("button", name="Submit request", exact=True))
        vis(pg.get_by_text("Request received. Your reference is REQ-0001.", exact=True))


def test_wf_W09_intake_mapping(browser, app_url):
    clock(app_url, "2026-03-02T09:00:00Z")
    w, slug = intake_world(app_url)
    c = client(app_url, w.who["noor"].email)
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    form = anon.get(f"/api/forms/{slug}").json()
    assert form["title"] == "Supply request" and form["categories"] == ["Dry goods", "Fresh", "Equipment"]
    assert anon.get("/api/forms/none-" + uid()).status_code == 404
    errs = anon.post(f"/api/forms/{slug}/submissions", json={}).json()["errors"]
    assert errs == {"title": "Enter a request title", "neededBy": "Enter a date today or later", "email": "Enter an email address like name@example.com"}
    ok = {"title": "Dry goods top-up", "details": "Two pallets", "neededBy": "2026-03-05", "email": f"req.{w.n}@example.test", "category": "Fresh"}
    for patch_, field, msg in (({"title": "x" * 121}, "title", "Request title must be 120 characters or fewer"), ({"neededBy": "2026-03-01"}, "neededBy", "Enter a date today or later"),
                               ({"category": "Nope"}, "category", "Choose a category from the list")):
        r = anon.post(f"/api/forms/{slug}/submissions", json={**ok, **patch_})
        assert r.status_code == 422 and r.json()["errors"][field] == msg
    assert all_tasks(c, w.project) == []
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        r = anon.post(f"/api/forms/{slug}/submissions", json=ok)
        assert r.status_code == 201 and r.json()["reference"] == "REQ-0001"
        vis(ob(pg, "Dry goods top-up"))
        t = get_task(c, r.json()["taskId"])
        assert (t["name"], t["description"], t["due"], t["section"]) == ("Dry goods top-up", "Two pallets", "2026-03-05", w.sections["To do"])
        assert t["values"]["Category"] == "Fresh" and t["values"]["Requested by"] == ok["email"]
        assert anon.post(f"/api/forms/{slug}/submissions", json=ok).json()["reference"] == f"REQ-{2:04d}"


def test_wf_W09_intake_phone(browser, app_url):
    w, slug = intake_world(app_url)
    with view(browser, app_url, None, f"/f/{slug}", size=PHONE) as pg:
        names = ("Request title", "Details", "Needed by", "Your email")
        vis(pg.get_by_role("textbox", name=names[0], exact=True))
        boxes = [pg.get_by_role("textbox", name=n, exact=True).bounding_box() for n in names]
        assert max(b["x"] for b in boxes) - min(b["x"] for b in boxes) <= 2
        assert [b["y"] for b in boxes] == sorted(b["y"] for b in boxes)
        layout(pg)
        pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        stops = 0
        for _ in range(TAB_WALK_MAX):
            pg.keyboard.press("Shift+Tab")
            r = pg.evaluate(TAB_STOP_JS)
            if r in ("body", "same"):
                continue
            if r is None:
                break
            stops += 1
            if not r[0]:
                assert r[1] >= TOP_BAR_PX and r[2] >= 0 and r[3] <= r[4], r
        assert stops >= len(names), f"only {stops} tab stops reached on the form"


def test_wf_W09_form_uses_server_clock(browser, app_url):
    clock(app_url, "2026-03-02T09:00:00Z")
    w, slug = intake_world(app_url)
    with view(browser, app_url, None, f"/f/{slug}") as pg:
        pg.clock.set_fixed_time("2040-01-01T00:00:00Z")
        pg.reload()
        fill(pg.get_by_role("textbox", name="Request title", exact=True), "Clock check")
        fill(pg.get_by_role("textbox", name="Your email", exact=True), f"req.{w.n}@example.test")
        needed = pg.get_by_role("textbox", name="Needed by", exact=True)
        fill(needed, "2026-03-01")
        click(pg.get_by_role("button", name="Submit request", exact=True))
        vis(pg.get_by_text("Enter a date today or later", exact=True).first)
        fill(needed, "2026-03-02")
        click(pg.get_by_role("button", name="Submit request", exact=True))
        vis(pg.get_by_text("Request received. Your reference is REQ-0001.", exact=True))


def approval_world(base):
    w = world(base, tasks=[T("a", "Pack orders")])
    noor, tomas = client(base, w.who["noor"].email), client(base, w.who["tomas"].email)
    return w, noor, tomas


def test_wf_W10_decide_dialog(browser, app_url):
    w, noor, _ = approval_world(app_url)
    assert noor.post(f"/api/tasks/{w.tasks['a']}/approval", json={"approverId": w.who["tomas"].id}).status_code == 201
    with view(browser, app_url, w.who["tomas"].email, "/inbox") as pg:
        decide = pg.get_by_role("button", name="Decide", exact=True).first
        vis(decide)
        click(decide)
        dlg = pg.get_by_role("dialog", name="Decide on Pack orders", exact=True)
        vis(dlg)
        for _ in range(10):
            pg.keyboard.press("Tab")
            assert active_in(dlg)
        pg.keyboard.press("Escape")
        gone(dlg)
        foc(decide)
        click(decide)
        vis(dlg)
        check(dlg.get_by_role("radio", name="Reject", exact=True))
        click(dlg.get_by_role("button", name="Submit decision", exact=True))
        vis(dlg.get_by_text("Add a comment for this decision", exact=True))
        check(dlg.get_by_role("radio", name="Approve", exact=True))
        click(dlg.get_by_role("button", name="Submit decision", exact=True))
        gone(dlg)


def test_wf_W10_state_machine(app_url):
    w, noor, tomas = approval_world(app_url)
    ilse = client(app_url, w.who["ilse"].email)
    tid, ask = w.tasks["a"], f"/api/tasks/{w.tasks['a']}"
    assert noor.post(ask + "/approval", json={"approverId": "nobody-" + uid()}).status_code == 422
    r = noor.post(ask + "/approval", json={"approverId": w.who["tomas"].id})
    assert (r.status_code, r.json()) == (201, {"status": "requested", "approverId": w.who["tomas"].id})
    r = noor.post(ask + "/approval", json={"approverId": w.who["tomas"].id})
    assert (r.status_code, r.json()) == (409, {"error": "already_requested"})
    assert ilse.post(ask + "/decision", json={"decision": "approve"}).status_code == 403
    r = tomas.post(ask + "/decision", json={"decision": "maybe"})
    assert r.status_code == 422 and r.json()["errors"]["decision"] == "Choose a decision"
    r = tomas.post(ask + "/decision", json={"decision": "reject"})
    assert r.status_code == 422 and r.json()["errors"]["comment"] == "Add a comment for this decision"
    r = tomas.post(ask + "/decision", json={"decision": "approve", "comment": "x" * 501})
    assert r.json()["errors"]["comment"] == "Comment must be 500 characters or fewer"
    r = tomas.post(ask + "/decision", json={"decision": "request_changes", "comment": "Needs detail"})
    assert (r.status_code, r.json()) == (200, {"status": "changes_requested"})
    r = tomas.post(ask + "/decision", json={"decision": "maybe"})
    assert (r.status_code, r.json()) == (409, {"error": "already_decided"})
    assert noor.post(ask + "/approval", json={"approverId": w.who["tomas"].id}).status_code == 201
    assert tomas.post(ask + "/decision", json={"decision": "reject", "comment": "No"}).json() == {"status": "rejected"}
    texts = [i["text"] for i in noor.get("/api/inbox").json()["items"]]
    assert f"{w.who['tomas'].name} requested changes on Pack orders" in texts and f"{w.who['tomas'].name} rejected Pack orders" in texts
    assert "Approval requested: Pack orders" in [i["text"] for i in tomas.get("/api/inbox").json()["items"]]
    assert get_task(noor, tid)["approval"]["status"] == "rejected"
    assert noor.post(ask + "/approval", json={"approverId": w.who["tomas"].id}).status_code == 201
    assert tomas.post(ask + "/decision", json={"decision": "approve"}).json() == {"status": "approved"}
    assert f"{w.who['tomas'].name} approved Pack orders" in [i["text"] for i in noor.get("/api/inbox").json()["items"]]


def test_wf_W10_decision_results(browser, app_url):
    w, noor, _ = approval_world(app_url)
    assert noor.post(f"/api/tasks/{w.tasks['a']}/approval", json={"approverId": w.who["tomas"].id}).status_code == 201
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as req, view(browser, app_url, w.who["tomas"].email, "/inbox") as app:
        click(ob(req, "Pack orders"))
        panel = detail(req, "Pack orders")
        vis(panel.get_by_text("Awaiting approval", exact=True))
        click(app.get_by_role("button", name="Decide", exact=True).first)
        dlg = app.get_by_role("dialog", name="Decide on Pack orders", exact=True)
        check(dlg.get_by_role("radio", name="Approve", exact=True))
        click(dlg.get_by_role("button", name="Submit decision", exact=True))
        has(st(app, "Approval status"), "Decision saved: Approved")
        vis(panel.get_by_text("Approved", exact=True))
        vis(req.get_by_role("link", name="Inbox, 1 unread", exact=True))
        has(st(req, "Inbox status"), f"New in inbox: {w.who['tomas'].name} approved Pack orders")
    assert f"{w.who['tomas'].name} approved Pack orders" in [i["text"] for i in noor.get("/api/inbox").json()["items"]]


DIGEST_DAY = "2026-02-16"


def mails_to(mail, email, page=50):
    out, start = [], 0
    for _ in range(200):
        j = mail.client.get("/api/v1/search", params={"query": f'to:"{email}"', "start": start, "limit": page}).json()
        items = j.get("messages") or []
        out += [m for m in items if email.lower() in addresses(m.get("To"))]
        start += len(items)
        if not items or start >= j.get("messages_count", j.get("total", 0)):
            break
    return [mail.client.get(f"/api/v1/message/{m['ID']}").json() for m in out]


INTO_ITEM_JS = """e => {
    const t = e.matches('button, a[href], input, [tabindex]') ? e : (e.querySelector('button, a[href], input, [tabindex]') || e);
    t.focus();
    return e.contains(document.activeElement);
}"""


def mini(base, items=()):
    n = uid()
    people = [{"key": k, "name": f"{k.title()} {n}", "email": f"{k}.{n}@example.test", "password": PW, "verified": True} for k in ("noor", "ilse")]
    inbox = [{"key": f"i{i}", "person": "noor", "text": t, "createdAt": ts, "read": r} for i, (t, ts, r) in enumerate(items)]
    res = seed(base, {"people": people, "teams": [{"key": "t", "name": f"Team {n}", "members": ["noor", "ilse"], "coordinators": ["noor"]}], "inbox": inbox})
    return {p["key"]: SimpleNamespace(id=res["people"][p["key"]], name=p["name"], email=p["email"]) for p in people}


def test_wf_W11_inbox_keyboard(browser, app_url):
    who = mini(app_url, [("Order dry goods", "2026-03-01T08:00:00Z", False), ("Pack orders", "2026-03-01T09:00:00Z", False), ("Count freezer", "2026-03-01T10:00:00Z", False)])
    c = client(app_url, who["noor"].email)
    with view(browser, app_url, who["noor"].email, "/inbox") as pg:
        items = pg.locator("[data-item]")
        expect(items).to_have_count(3, timeout=LIVE_WAIT_MS)
        eventually(lambda: pg.keyboard.press("Tab") or pg.evaluate("() => !!document.activeElement.closest('[data-item]')"), "Tab reached an inbox item")
        pg.keyboard.press("ArrowDown")
        assert "Pack orders" in pg.evaluate("() => document.activeElement.closest('[data-item]').innerText")
        two = items.filter(has_text="Pack orders")
        pg.keyboard.press("m")
        has(st(pg, "Inbox status"), "Marked as read")
        attr(two, "data-read", "true")
        pg.keyboard.press("m")
        has(st(pg, "Inbox status"), "Marked as unread")
        attr(two, "data-read", "false")
        pg.keyboard.press("e")
        has(st(pg, "Inbox status"), "Archived")
        gone(items.filter(has_text="Pack orders"))
        eventually(lambda: not pg.evaluate("() => document.activeElement === document.body"), "focus left the page body")
        for left in (1, 0):
            assert items.first.evaluate(INTO_ITEM_JS), "focus reached an inbox item"
            pg.keyboard.press("e")
            expect(items).to_have_count(left, timeout=LIVE_WAIT_MS)
        vis(pg.get_by_role("heading", name="Inbox is empty", exact=True))
        vis(pg.get_by_role("link", name="Inbox, 0 unread", exact=True))
        focus_kept(pg, "archiving the last inbox item")
    assert "Pack orders" not in [i["text"] for i in c.get("/api/inbox").json()["items"]]


def test_wf_W11_live_inbox(browser, app_url):
    w, noor, tomas = approval_world(app_url)
    with view(browser, app_url, w.who["tomas"].email, "/inbox") as pg, view(browser, app_url, w.who["tomas"].email, "/") as home:
        vis(pg.get_by_role("heading", name="Inbox is empty", exact=True))
        vis(home.get_by_role("link", name="Inbox, 0 unread", exact=True))
        assert noor.post(f"/api/tasks/{w.tasks['a']}/approval", json={"approverId": w.who["tomas"].id}).status_code == 201
        has(st(pg, "Inbox status"), "New in inbox: Approval requested: Pack orders")
        vis(pg.locator("[data-item]").first.get_by_text("Approval requested: Pack orders"))
        vis(home.get_by_role("link", name="Inbox, 1 unread", exact=True))
        item = tomas.get("/api/inbox").json()["items"][0]
        assert tomas.patch(f"/api/inbox/{item['id']}", json={"read": True}).status_code == 200
        vis(home.get_by_role("link", name="Inbox, 0 unread", exact=True))


def test_wf_W11_digest(app_url, down_url, mail):
    clock(app_url, f"{DIGEST_DAY}T09:30:00Z")
    who = mini(app_url, [("Order dry goods", f"{DIGEST_DAY}T09:10:00Z", False), ("Pack orders", f"{DIGEST_DAY}T09:20:00Z", False),
                         ("Count freezer", f"{DIGEST_DAY}T09:15:00Z", True)])
    ts = [threading.Thread(target=clock, args=(b, f"{DIGEST_DAY}T10:00:30Z")) for b in (app_url, down_url)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    eventually(lambda: mails_to(mail, who["noor"].email), f"digest mail to {who['noor'].email}", seconds=40)
    clock(app_url, f"{DIGEST_DAY}T10:00:30Z")
    _tick.wait(1.5)
    got = mails_to(mail, who["noor"].email)
    assert len(got) == 1 and got[0]["Subject"] == "Everyweek: 2 unread in your inbox"
    body = text(got[0])
    assert "Order dry goods" in body and "Pack orders" in body and "Count freezer" not in body
    assert not mails_to(mail, who["ilse"].email)


def test_wf_W12_hold_api(app_url):
    w = world(app_url, tasks=[T("a", "Pack orders")])
    a, b = client(app_url, w.who["noor"].email), client(app_url, w.who["ilse"].email)
    hold = f"/api/tasks/{w.tasks['a']}/hold"
    r = a.post(hold, json={"field": "name"})
    assert r.status_code == 200 and r.json()["holder"]["name"] == w.who["noor"].name and r.json()["expiresAt"]
    r = b.post(hold, json={"field": "name"})
    assert (r.status_code, r.json()) == (409, {"error": "held_by_other", "holder": w.who["noor"].name})
    v = get_task(b, w.tasks["a"])["version"]
    r = b.patch(f"/api/tasks/{w.tasks['a']}", json={"version": v - 1, "name": "Mine", "effort": -1})
    assert r.status_code == 409 and r.json()["error"] == "held_by_other"
    assert b.post(hold, json={"field": "bogus"}).json()["errors"]["field"] == "Choose name or description"
    assert a.request("DELETE", hold, json={"field": "name"}).status_code == 204
    assert b.post(hold, json={"field": "name"}).status_code == 200


def test_wf_W12_hold_ui(browser, app_url):
    w = world(app_url, tasks=[T("a", "Pack orders")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg, view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        for p in (pg, other):
            click(ob(p, "Pack orders"))
            vis(detail(p, "Pack orders"))
        mine = detail(pg, "Pack orders").get_by_role("textbox", name="Name", exact=True)
        theirs = detail(other, "Pack orders").get_by_role("textbox", name="Name", exact=True)
        mine.focus()
        vis(detail(other, "Pack orders").get_by_text(f"Being edited by {w.who['noor'].name}"))
        attr(theirs, "aria-readonly", "true")
        fill(mine, "Weigh stock")
        click(detail(pg, "Pack orders").get_by_role("button", name="Save name", exact=True))
        eventually(lambda: get_task(c, w.tasks["a"])["name"] == "Weigh stock", "name saved")
        expect(other.get_by_role("textbox", name="Name", exact=True)).to_have_value("Weigh stock", timeout=LIVE_WAIT_MS)
        gone(other.get_by_text(f"Being edited by {w.who['noor'].name}"))


def test_wf_W12_stale_dialog(browser, app_url):
    w = world(app_url, tasks=[T("a", "Pack orders", description="first")])
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}", block_events=True) as pg:
        click(ob(pg, "Pack orders"))
        panel = detail(pg, "Pack orders")
        vis(panel)
        desc = panel.get_by_role("textbox", name="Description", exact=True)
        save = panel.get_by_role("button", name="Save description", exact=True)
        dlg = pg.get_by_role("dialog", name="This task changed", exact=True)
        assert patch(c, w.tasks["a"], effort=1).status_code == 200
        fill(desc, "Weigh stock")
        click(save)
        vis(dlg)
        vis(dlg.get_by_text("Someone saved this task after you opened it.", exact=True))
        gone(pg.get_by_text(STALE_TOAST, exact=True))
        for _ in range(6):
            pg.keyboard.press("Tab")
            assert active_in(dlg)
        click(dlg.get_by_role("button", name="Keep my edit", exact=True))
        gone(dlg)
        eventually(lambda: get_task(c, w.tasks["a"])["description"] == "Weigh stock", "Keep my edit saved the text")
        foc(save)
        assert patch(c, w.tasks["a"], effort=2).status_code == 200
        fill(desc, "other")
        click(save)
        vis(dlg)
        click(dlg.get_by_role("button", name="Load latest", exact=True))
        gone(dlg)
        expect(desc).to_have_value("Weigh stock", timeout=LIVE_WAIT_MS)
        assert patch(c, w.tasks["a"], effort=3).status_code == 200
        fill(desc, "again")
        click(save)
        vis(dlg)
        advance(pg, 1000)
        vis(dlg)


def test_wf_W12_concurrent_saves(app_url, down_url):
    w = world(app_url, tasks=[T("a", "Pack orders")])
    cs = [client(app_url, w.who["noor"].email), client(down_url, w.who["ilse"].email)]
    v = get_task(cs[0], w.tasks["a"])["version"]
    out = []
    ts = [threading.Thread(target=lambda cl=cl, i=i: out.append(cl.patch(f"/api/tasks/{w.tasks['a']}", json={"version": v, "name": f"Winner {i}"}))) for i, cl in enumerate(cs)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(r.status_code for r in out) == [200, 409]
    loser = next(r for r in out if r.status_code == 409)
    assert loser.json() == {"error": "stale_task", "latest": v + 1}


def test_wf_W12_hold_lapse(browser, app_url):
    t0 = f"{DIGEST_DAY}T12:00:00"
    clock(app_url, t0 + "Z")
    w = world(app_url, tasks=[T("a", "Pack orders")])
    a, b = client(app_url, w.who["noor"].email), client(app_url, w.who["ilse"].email)
    r = a.post(f"/api/tasks/{w.tasks['a']}/hold", json={"field": "name"})
    gap = datetime.fromisoformat(r.json()["expiresAt"].replace("Z", "+00:00")) - datetime.fromisoformat(t0 + "+00:00")
    assert abs(gap.total_seconds() - 30) < 1
    with view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        click(ob(other, "Pack orders"))
        panel = detail(other, "Pack orders")
        viewing = panel.get_by_role("list", name="Viewing now")
        with view(browser, app_url, w.who["tomas"].email, f"/projects/{w.project}") as lost:
            click(ob(lost, "Pack orders"))
            vis(viewing.get_by_text(w.who["tomas"].name))
        vis(panel.get_by_text(f"Being edited by {w.who['noor'].name}"))
        attr(panel.get_by_role("textbox", name="Name", exact=True), "aria-readonly", "true")
        clock(app_url, f"{DIGEST_DAY}T12:00:31Z")
        gone(panel.get_by_text(f"Being edited by {w.who['noor'].name}"))
        gone(viewing.get_by_text(w.who["tomas"].name))
        expect(panel.get_by_role("textbox", name="Name", exact=True)).not_to_have_attribute("aria-readonly", "true", timeout=LIVE_WAIT_MS)
    assert b.post(f"/api/tasks/{w.tasks['a']}/hold", json={"field": "name"}).status_code == 200


def test_wf_W13_phone_tabs_sheet(browser, app_url):
    w = board_world(app_url)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}", size=PHONE) as pg:
        tabs = pg.get_by_role("tablist", name="Project views")
        tab = lambda n: tabs.get_by_role("tab", name=n, exact=True)
        vis(tab("List"))
        tab("List").focus()
        pg.keyboard.press("ArrowRight")
        attr(tab("Board"), "aria-selected", "true")
        pg.keyboard.press("ArrowRight")
        attr(tab("Timeline"), "aria-selected", "true")
        pg.keyboard.press("ArrowLeft")
        attr(tab("Board"), "aria-selected", "true")
        opener = card(pg, "Order dry goods", "To do", 1, 3)
        tap(opener)
        sheet = detail(pg, "Order dry goods")
        vis(sheet)
        box = sheet.bounding_box()
        assert box["width"] >= PHONE["width"] - 2 and box["y"] + box["height"] >= PHONE["height"] - 2 and box["height"] >= PHONE["height"] / 2
        click(sheet.get_by_role("button", name="Close task", exact=True))
        gone(sheet)
        foc(opener)
        tap(opener)
        vis(sheet)
        pg.keyboard.press("Escape")
        gone(sheet)
        foc(opener)


def test_wf_W13_touch_drag(browser, app_url):
    w = board_world(app_url)
    c = client(app_url, w.who["noor"].email)
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=board", size=PHONE) as pg:
        src = card(pg, "Order dry goods", "To do", 1, 3)
        vis(src)
        s = session(pg)
        s.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        x, _ = center(src)
        src.evaluate("e => window.scrollTo({top: window.scrollY + e.getBoundingClientRect().top - 72, behavior: 'instant'})")
        sbox = src.bounding_box()
        y = sbox["y"] + sbox["height"] - min(10, sbox["height"] / 4)
        assert src.evaluate("(e, p) => { const h = document.elementFromPoint(p.x, p.y); return h === e || e.contains(h); }", {"x": x, "y": y})
        gbox = pg.get_by_role("group", name="Doing", exact=True).bounding_box()
        tx = gbox["x"] + gbox["width"] / 2
        ty = min(gbox["y"] + 20, PHONE["height"] - 4)
        assert gbox["y"] < ty < gbox["y"] + gbox["height"], f"Doing group {gbox} cannot be reached on screen from the source card"
        before = pg.evaluate("() => window.scrollY")
        s.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, 11):
            s.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + (tx - x) * i / 10, "y": y + (ty - y) * i / 10}]})
        s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        eventually(lambda: get_task(c, w.tasks["a"])["section"] == w.sections["Doing"], "touch drag saved")
        assert pg.evaluate("() => window.scrollY") == before


def test_wf_W13_breakpoints(browser, app_url):
    secs = ("To do", "Doing", "Review", "Done")
    w = world(app_url, sections=secs, tasks=[T(f"t{i}", f"Job {i}", s) for i, s in enumerate(secs)])
    for size in (DESKTOP, TABLET, PHONE):
        with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}?view=board", size=size) as pg:
            vis(pg.get_by_role("group", name="To do", exact=True))
            layout(pg)
            attr(pg.get_by_role("button", name="Project panel", exact=True), "aria-expanded", "true" if size is DESKTOP else "false")
            b = [pg.get_by_role("group", name=s, exact=True).bounding_box() for s in secs]
            if size is DESKTOP:
                assert len({round(x["y"]) for x in b}) == 1 and [x["x"] for x in b] == sorted(x["x"] for x in b)
            elif size is TABLET:
                assert abs(b[0]["y"] - b[1]["y"]) <= 2 and b[2]["y"] > b[0]["y"] + 10 and abs(b[0]["x"] - b[2]["x"]) <= 2
            else:
                assert max(x["x"] for x in b) - min(x["x"] for x in b) <= 2 and [x["y"] for x in b] == sorted(x["y"] for x in b)
            mywork = pg.get_by_role("link", name="My work", exact=True)
            if size is PHONE:
                gone(mywork)
                click(pg.get_by_role("button", name="Menu", exact=True))
            vis(mywork)
            pg.keyboard.press("Escape")
            for _ in range(15):
                pg.keyboard.press("Tab")
                r = pg.evaluate("() => { const e = document.activeElement; if (!e || e === document.body || e === document.documentElement) return null; let s = false; for (let p = e; p; p = p.parentElement) { const q = getComputedStyle(p), w = p.getBoundingClientRect(); if (q.position === 'sticky' || (q.position === 'fixed' && Math.abs(w.top) <= 1 && w.width >= innerWidth - 1)) s = true; } const b = e.getBoundingClientRect(); return [s, b.top, b.left, b.right, innerWidth]; }")
                if r is None:
                    continue
                assert r[2] >= 0 and r[3] <= r[4] + 1
                if not r[0]:
                    assert r[1] >= TOP_BAR_PX
            if size is TABLET:
                click(card(pg, "Job 0", "To do", 1, 1))
                box = detail(pg, "Job 0").bounding_box()
                assert box["x"] + box["width"] >= size["width"] - 2 and 0.5 * size["width"] <= box["width"] <= 0.8 * size["width"]


def test_wf_W14_other_team_project(browser, app_url):
    w, other = world(app_url, tasks=[T("a", "Mine")]), world(app_url, tasks=[T("x", "Theirs")])
    c = client(app_url, w.who["noor"].email)
    for method, path in (("GET", f"/api/projects/{other.project}"), ("GET", f"/api/projects/{other.project}/tasks"), ("GET", f"/api/projects/{other.project}/rules"),
                         ("POST", f"/api/projects/{other.project}/tasks"), ("GET", f"/api/tasks/{other.tasks['x']}"), ("DELETE", f"/api/tasks/{other.tasks['x']}")):
        r = c.request(method, path, json={"name": "Intruder"} if method == "POST" else None)
        assert (r.status_code, r.json()) == (404, {"error": "not_found"}), path
    assert [t["name"] for t in all_tasks(client(app_url, other.who["noor"].email), other.project)] == ["Theirs"]
    for pid in (other.project, "unknown-" + uid()):
        with view(browser, app_url, w.who["noor"].email, f"/projects/{pid}") as pg:
            vis(pg.get_by_role("heading", name="Project not found", exact=True))
            gone(pg.get_by_text(f"Project {other.n}"))


def test_wf_W14_deletions(browser, app_url):
    w = world(app_url, fields=[F("extra", "Extra", "text")], tasks=[T("a", "T one"), T("b", "T two"), T("c", "T three")])
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg, view(browser, app_url, w.who["ilse"].email, f"/projects/{w.project}") as other:
        ls = st(pg, "List status")

        def delete_task(name, then):
            click(ob(pg, name))
            click(detail(pg, name).get_by_role("button", name="Delete task", exact=True))
            click(pg.get_by_role("dialog", name=f"Delete {name}?", exact=True).get_by_role("button", name="Delete", exact=True))
            has(ls, "Task deleted")
            gone(other.get_by_role("row").filter(has_text=name))
            if then:
                eventually(lambda: then in row_of_active(pg), f"focus on the row of {then}")
        delete_task("T two", "T three")
        delete_task("T three", "T one")
        delete_task("T one", None)
        foc(pg.get_by_role("textbox", name="Add task").first)
        if pg.get_by_role("button", name="Delete field", exact=True).count() == 0:
            click(pg.get_by_role("button", name="Edit field Extra", exact=True))
        click(pg.get_by_role("button", name="Delete field", exact=True).first)
        click(pg.get_by_role("dialog", name="Delete Extra?", exact=True).get_by_role("button", name="Delete", exact=True))
        has(ls, "Field deleted")
        foc(pg.get_by_role("button", name="Add field", exact=True))
        click(pg.get_by_role("button", name="Delete section", exact=True).first)
        click(pg.get_by_role("dialog", name="Delete To do?", exact=True).get_by_role("button", name="Delete", exact=True))
        has(ls, "Section deleted")
        foc(pg.get_by_role("button", name="Doing", exact=True))
        expect(pg.get_by_role("button", name="Delete section", exact=True)).to_be_disabled()


def test_wf_W14_delete_api(app_url):
    w = world(app_url, sections=("To do", "Doing"), tasks=[T("p", "Parent"), T("s", "Child", parent="p"), T("d", "Other", "Doing")])
    c = client(app_url, w.who["noor"].email)
    assert c.delete(f"/api/tasks/{w.tasks['p']}").status_code == 204
    assert c.get(f"/api/tasks/{w.tasks['s']}").status_code == 404
    assert c.delete(f"/api/sections/{w.sections['Doing']}").status_code == 204
    assert c.get(f"/api/tasks/{w.tasks['d']}").status_code == 404
    r = c.delete(f"/api/sections/{w.sections['To do']}")
    assert (r.status_code, r.json()) == (422, {"errors": {"section": "A project needs at least one section"}})


@pytest.mark.parametrize("kind", CONFIRM_KINDS, ids=CONFIRM_KINDS)
def test_wf_W14_delete_confirm_focus(browser, app_url, kind):
    w = world(app_url, fields=[F("extra", "Extra", "text")], tasks=[T("a", "T one")])
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        vis(ob(pg, "T one"))
        if kind == "task":
            click(ob(pg, "T one"))
            opener, name = detail(pg, "T one").get_by_role("button", name="Delete task", exact=True), "T one"
        elif kind == "section":
            opener, name = pg.get_by_role("button", name="Delete section", exact=True).first, "To do"
        else:
            if pg.get_by_role("button", name="Delete field", exact=True).count() == 0:
                click(pg.get_by_role("button", name="Edit field Extra", exact=True))
            opener, name = pg.get_by_role("button", name="Delete field", exact=True).first, "Extra"
        dlg = pg.get_by_role("dialog", name=f"Delete {name}?", exact=True)
        for closer in ("Cancel", "Escape"):
            click(opener)
            vis(dlg)
            for _ in range(6):
                pg.keyboard.press("Tab")
                assert active_in(dlg)
            if closer == "Cancel":
                click(dlg.get_by_role("button", name="Cancel", exact=True))
            else:
                pg.keyboard.press("Escape")
            gone(dlg)
            foc(opener)


def test_wf_W15_attachment_cap_api(app_url):
    w = world(app_url, tasks=[T("a", "Receipts")])
    c = client(app_url, w.who["noor"].email)
    s3, tid = S3(), w.tasks["a"]
    body = b"x" * UPLOAD_CAP
    r = c.post(f"/api/tasks/{tid}/attachments", files={"file": ("receipt", body, "text/plain")})
    assert r.status_code == 201 and r.json()["name"] == "receipt" and r.json()["size"] == UPLOAD_CAP
    key = f"attachments/{tid}/{r.json()['id']}/receipt"
    assert key in s3.keys(f"attachments/{tid}/") and s3.get(key) == body
    got = c.get(f"/api/attachments/{r.json()['id']}")
    assert got.status_code == 200 and got.content == body and got.headers["content-type"].startswith("text/plain")
    before = s3.keys(f"attachments/{tid}/")
    r = c.post(f"/api/tasks/{tid}/attachments", files={"other": ("big.bin", b"x" * (UPLOAD_CAP + 1))})
    assert (r.status_code, r.json()) == (413, {"error": "file_too_large"})
    assert s3.keys(f"attachments/{tid}/") == before
    r = c.post(f"/api/tasks/{tid}/attachments", files={"note": (None, "x")})
    assert (r.status_code, r.json()) == (422, {"errors": {"file": "Choose a file to attach"}})


def test_wf_W15_attachment_ui(browser, app_url, down_url):
    w = world(app_url, tasks=[T("a", "Receipts")])
    for base, big, msg in ((app_url, True, "File is larger than 1 MB"),
                           (down_url, False, "Attachment failed: file storage is unavailable. Nothing was saved.")):
        with view(browser, base, w.who["noor"].email, f"/projects/{w.project}") as pg:
            click(ob(pg, "Receipts"))
            panel = detail(pg, "Receipts")
            with pg.expect_file_chooser() as fc:
                click(panel.get_by_role("button", name="Attach file", exact=True))
            fc.value.set_files([{"name": "r.txt", "mimeType": "text/plain", "buffer": b"x" * (UPLOAD_CAP + 1 if big else 10)}])
            has(panel.get_by_role("alert"), msg)
            if not big:
                vis(pg.get_by_text("File storage is unavailable. Everything else keeps working.", exact=True))


def test_wf_W15_download_ready(browser, app_url):
    w = world(app_url, sections=("To do", "Done"), tasks=[
        T("a", "Alpha", assignee="noor", start="2026-03-02", due="2026-03-04", effort=2.5), T("b", "Beta", parent="a"), T("g", "Gamma", "Done", completed=True)])
    c = client(app_url, w.who["noor"].email)
    s3 = S3()
    with view(browser, app_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        click(pg.get_by_role("button", name="Download project", exact=True))
        dlg = pg.get_by_role("dialog", name="Download project", exact=True)
        check(dlg.get_by_role("radio", name="CSV", exact=True))
        prepare = dlg.get_by_role("button", name="Prepare file", exact=True)
        gone(dlg.get_by_role("link", name="Download CSV", exact=True))
        click(prepare)
        clocked_has(pg, dlg.get_by_role("status", name="Download status", exact=True), "Ready")
        vis(dlg.get_by_role("link", name="Download CSV", exact=True))
        foc(prepare)
    key = next(k for k in s3.keys(f"exports/{w.project}/") if k.endswith(".csv"))
    rows = {r["name"]: r for r in csv.DictReader(io.StringIO(s3.get(key).decode()))}
    assert s3.get(key).decode().splitlines()[0] == "id,name,section,assignee_email,start,due,effort_hours,completed,parent_id"
    a = rows["Alpha"]
    assert (a["section"], a["assignee_email"], a["start"], a["due"], float(a["effort_hours"]), a["completed"], a["parent_id"]) == (
        "To do", w.who["noor"].email, "2026-03-02", "2026-03-04", 2.5, "false", "")
    assert rows["Beta"]["parent_id"] == a["id"] and rows["Gamma"]["completed"] == "true" and rows["Gamma"]["section"] == "Done"
    r = c.post(f"/api/projects/{w.project}/files", json={"format": "pdf"})
    assert r.status_code == 422 and r.json()["errors"]["format"] == "Choose csv or json"
    r = c.post(f"/api/projects/{w.project}/files", json={"format": "json"})
    assert r.status_code == 202 and r.json()["status"] == "preparing"
    fid = r.json()["id"]
    done = eventually(lambda: c.get(f"/api/files/{fid}").json() if c.get(f"/api/files/{fid}").json()["status"] != "preparing" else None, "file job finished")
    assert done["status"] == "ready" and done["url"]
    assert any(k.endswith(f"{fid}.json") for k in s3.keys(f"exports/{w.project}/"))
    j = json.loads(c.get(f"/api/files/{fid}/download").content)
    assert j["schema"] == "everyweek.project/1" and j["project"]["id"] == w.project
    ta = {t["name"]: t for t in j["tasks"]}
    assert ta["Alpha"]["section"] == w.sections["To do"] and ta["Alpha"]["parent_id"] is None and ta["Beta"]["parent_id"] == ta["Alpha"]["id"]
    assert ta["Gamma"]["completed"] is True and ta["Alpha"]["assignee_email"] == w.who["noor"].email


def test_wf_W15_download_outage(browser, app_url, down_url):
    w = world(app_url, tasks=[T("a", "Alpha")])
    c = client(down_url, w.who["noor"].email)
    r = c.post(f"/api/projects/{w.project}/files", json={"format": "csv"})
    assert r.status_code == 202
    fid = r.json()["id"]
    job = eventually(lambda: c.get(f"/api/files/{fid}").json() if c.get(f"/api/files/{fid}").json()["status"] != "preparing" else None, "file job finished")
    assert job["status"] == "failed" and job["error"] == "storage_unavailable" and not job.get("url")
    assert S3().keys(f"exports/{w.project}/") == []
    with view(browser, down_url, w.who["noor"].email, f"/projects/{w.project}") as pg:
        click(pg.get_by_role("button", name="Download project", exact=True))
        dlg = pg.get_by_role("dialog", name="Download project", exact=True)
        check(dlg.get_by_role("radio", name="CSV", exact=True))
        click(dlg.get_by_role("button", name="Prepare file", exact=True))
        msg = dlg.get_by_role("status", name="Download status", exact=True)
        clocked_has(pg, msg, "Download failed: file storage is unavailable. Nothing was saved.")
        gone(dlg.get_by_role("link", name=re.compile(r"^Download (CSV|JSON)$")))
        vis(pg.get_by_text("File storage is unavailable. Everything else keeps working.", exact=True))
        assert active_in(dlg)
        mk(c, w.project, "Repaint trigger")
        advance(pg, 2000)
        has(msg, "Download failed: file storage is unavailable. Nothing was saved.")
        assert active_in(dlg)


APP_SRC = Path("/app")


def test_if_run_manifest():
    m = json.loads((APP_SRC / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_notices_list_packages():
    notices = (APP_SRC / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert "Instrument Sans" in notices and "OFL" in notices


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED)]
    assert not bad, bad


def test_if_only_brief_services():
    banned = {"redis", "ioredis", "mongodb", "mongoose", "amqplib", "kafkajs", "memcached", "nats", "better-sqlite3", "sqlite3"}
    assert not [p.name for p in shipped_packages() if p.name in banned]
    procs = ""
    for comm in Path("/proc").glob("[0-9]*/comm"):
        try:
            procs += comm.read_text(errors="ignore")
        except OSError:
            continue
    assert not [x for x in ("redis-server", "mongod", "rabbitmq", "memcached", "kafka") if x in procs]


def test_if_seeded_service_config_untouched(app_url, mail):
    assert mail_from_address() == "hello@everyweek.example"
    email = f"cfg.{uid()}@example.test"
    assert post_json(app_url, "/api/signup", {"name": "Cfg", "email": email, "password": "longenough1"}).status_code == 201
    assert mail_from_address() in [a.lower() for a in addresses(mail_for(mail, email)[0].get("From"))]


def test_if_no_credentials_in_source():
    secrets = [v for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if len(v := os.environ.get(k, "")) >= 6]
    skip = {"node_modules", ".git"}
    leaks = []
    for p in APP_SRC.rglob("*"):
        if any(part in skip for part in p.parts) or not p.is_file() or p.name.startswith((".env", "docker-compose", "compose")) or p.stat().st_size > 2_000_000:
            continue
        try:
            data = p.read_text(errors="ignore")
        except OSError:
            continue
        leaks += [str(p) for s in secrets if s in data]
    assert not leaks, leaks


def test_if_no_real_product_names(browser, app_url, mail):
    banned = ["trello", "notion", "jira", "slack", "airtable", "clickup", "basecamp", "monday.com", "smartsheet"]
    seen = ""
    with open_app(browser, app_url + "/") as pg:
        vis(pg.get_by_role("heading", level=1))
        seen += pg.inner_text("body")
        pg.goto(app_url + "/account")
        vis(pg.get_by_role("button", name="Create account"))
        seen += pg.inner_text("body")
    email = f"copy.{uid()}@example.test"
    post_json(app_url, "/api/signup", {"name": "Copy", "email": email, "password": "longenough1"})
    seen += text(mail_for(mail, email)[0])
    assert not [b for b in banned if b in seen.lower()]


def test_if_font_shipped():
    kinds = (".woff2", ".woff", ".ttf", ".otf")
    in_source = [p for p in APP_SRC.rglob("*") if p.suffix.lower() in kinds and "node_modules" not in p.parts]
    instrument = lambda p: "instrumentsans" in re.sub(r"[^a-z]", "", str(p).lower())
    in_package = [p for p in DEPLOYED_APP.glob("node_modules/**/*") if p.suffix.lower() in kinds and instrument(p)] if not in_source else []
    assert in_source or in_package, "no font file in the app source and no Instrument Sans font package installed"
