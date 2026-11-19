from __future__ import annotations

import contextlib
import json
import os
import re
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from importlib import import_module
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    advance,
    capture,
    click,
    decode,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    until,
)


DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}

PASSWORD = "long-enough-pass"
GRADING_KEY = os.environ.get("GRADING_KEY", "twig-grade-7f3c91d2")
TODAY = os.environ.get("OUTLINE_TODAY", "2026-11-05")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

UI_MS = 15_000
CHECK_MS = 500
POLL_S = 20
POLL_INTERVAL_S = 0.1
HTTP_S = 30
LIVE_MS = 2000
SAVE_DEBOUNCE_MS = 600
HERO_TYPING_MAX_S = 8
COLLAPSE_MAX_MS = 250
ZOOM_MAX_MS = 1000
BODY_LIMIT = 65_536
TEXT_MAX = 4000
SEARCH_MAX = 200
CODE_MINUTES = 15
HEARTBEAT_WAIT_MS = 20_000
TOUCH_MIN_PX = 44
SWIPE_MIN_PX = 48
SWIPE_PX = 80
SWIPE_STEPS = 8
SHORT_INVITE_TTL_S = 6
SHORT_TRASH_S = 6
SHORT_CODE_S = 6
SHORT_UNDO_DEPTH = 3
SHORT_MAX_DEPTH = 4
SHORT_STREAM_MAXLEN = 5

PLACEHOLDER = "This bullet was deleted."
TOP_BAR_PX = 64
GD_DATE = "2026-11-07"
PP_INSIDE = 3
CHILD_TEXT = "Kid"
COLLAB_TOMATOES = "Tomatoes by collaborator"
COLLAB_SHORT = "Tomatoes collab"
DIG_TEXT = "Dig #Soil @Mira mid#word"
DELIVERED = "Compost, delivered"
WATER = "Water"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "bullet"


def _ctype(value: str) -> str:
    return value.replace(" ", "").lower()
JSON_HEADERS = {"Content-Type": "application/json; charset=utf-8"}

T = {
    "cgb": "Community garden build",
    "sp": "Site prep #soil",
    "clear": "Clear the lot !(2026-11-07)",
    "ph": "Test soil pH #soil @Mira",
    "pp": "Planting plan",
    "tom": "Tomatoes #seedlings",
    "herb": "Herb spiral @Jonah !(2026-11-12)",
    "wild": "Native wildflowers #seedlings",
    "vol": "Volunteers",
    "crew": "Saturday crew @Mira",
    "tool": "Tool library sign-out",
    "wheel": "Borrow the wheelbarrow !(2026-11-08)",
    "we": "Weekly errands",
    "buy": "Buy compost bags #soil",
    "ret": "Return library books",
}

VALUE_JS = "el => (typeof el.value === 'string' ? el.value : el.textContent)"
ORDER_JS = """([first, second]) => {
  const find = (id) => document.querySelector('[role="treeitem"][data-bullet-id="' + id + '"]');
  const a = find(first), b = find(second);
  return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}"""
INSIDE_JS = """([parent, child]) => {
  const find = (id) => document.querySelector('[role="treeitem"][data-bullet-id="' + id + '"]');
  const p = find(parent), c = find(child);
  return !!p && !!c && p !== c && p.contains(c);
}"""
RING_JS = """el => {
  const s = getComputedStyle(el);
  return (s.outlineStyle !== 'none' && s.outlineStyle !== 'hidden' && s.outlineWidth !== '0px') || s.boxShadow !== 'none';
}"""
COLLAPSE_JS = """(id) => new Promise((resolve) => {
  const el = () => document.querySelector('[role="treeitem"][data-bullet-id="' + id + '"]');
  const t0 = performance.now();
  const h0 = el().getBoundingClientRect().height;
  const heights = [];
  let start = null, last = null, prev = h0;
  const step = () => {
    const now = performance.now() - t0;
    const e = el();
    const h = e ? e.getBoundingClientRect().height : 0;
    if (start === null && h < h0 - 0.5) start = now;
    if (Math.abs(h - prev) > 0.5) { last = now; prev = h; heights.push(h); }
    if (now < 800) requestAnimationFrame(step); else resolve({start: start, last: last, heights: heights});
  };
  step();
})"""
SETTLE_JS = """(ids) => new Promise((resolve) => {
  const t0 = performance.now();
  const lastLow = ids.map(() => -1);
  const sample = () => {
    const now = performance.now() - t0;
    ids.forEach((id, k) => {
      const el = document.querySelector('[role="treeitem"][data-bullet-id="' + id + '"]');
      let o = 0;
      if (el && el.getBoundingClientRect().width > 0) {
        o = 1;
        for (let n = el; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
      }
      if (o < 0.99) lastLow[k] = now;
    });
    if (now < 1500) requestAnimationFrame(sample); else resolve(lastLow);
  };
  sample();
})"""
ZOOM_TITLE_MAX_MS = 250
SETTLE_BUCKET_MS = 20
HERO_STEP_MS = 10
HERO_SAMPLE_STEPS = 100
NEST_READY_JS = """() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').trim() === 'Nest it');
  return !!b && b.getAttribute('aria-disabled') !== 'true';
}"""
SNAPSHOT_ANIMS_JS = """() => document.getAnimations().map(a => {
  const el = a.effect && a.effect.target;
  const li = el && el.closest ? el.closest('li') : null;
  const timing = a.effect.getComputedTiming();
  return {text: li ? (li.textContent || '').trim() : '', begin: (a.startTime || 0) + timing.delay};
})"""
RECORD_ANIMATIONS_JS = """() => new Promise((resolve) => {
  const seen = new Map();
  const started = performance.now();
  const sweep = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a) || !a.effect || !a.effect.target) continue;
      const el = a.effect.target;
      const item = el.closest ? el.closest('[role="treeitem"]') : null;
      const timing = a.effect.getComputedTiming();
      const start = a.startTime === null ? document.timeline.currentTime : a.startTime;
      seen.set(a, {id: item ? item.getAttribute('data-bullet-id') : null,
                   begin: start + timing.delay, end: start + timing.endTime});
    }
    if (performance.now() - started < 1200) requestAnimationFrame(sweep); else resolve(Array.from(seen.values()));
  };
  sweep();
})"""
WS_JS = """([root, since, stopType, want, deadline]) => new Promise((resolve) => {
  const out = [];
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
    '/api/live?root=' + encodeURIComponent(root) + '&since=' + since;
  const ws = new WebSocket(url);
  const finish = () => { try { ws.close(); } catch (e) {} resolve(out); };
  const timer = setTimeout(finish, deadline);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    out.push(m);
    if (m.type === 'reload' || out.filter(x => x.type === stopType).length >= want) { clearTimeout(timer); finish(); }
  };
  ws.onerror = () => { out.push({type: 'error'}); clearTimeout(timer); finish(); };
})"""


def _helper(name: str):
    for module in ("conftest", "mailpit", "postgres", "valkey"):
        try:
            found = getattr(import_module(module), name, None)
        except ImportError:
            continue
        if found is not None:
            return found
    raise ImportError(f"no verifier helper named {name}")


@contextlib.contextmanager
def _drive(generator):
    value = next(generator)
    try:
        yield value
    finally:
        try:
            next(generator)
        except StopIteration:
            pass


def _cm(obj):
    return obj if hasattr(obj, "__enter__") else _drive(obj)


def client(base: str, cookies: dict | None = None) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_S, cookies=cookies)


def login(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session for {email} answered {r.status_code}; expected 200"
    return c


def clone(c: httpx.Client) -> httpx.Client:
    return client(str(c.base_url), {"twig_session": c.cookies.get("twig_session")})


def fire(calls):
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait(timeout=HTTP_S)
        return call()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def person(prefix: str) -> tuple[str, str]:
    tag = uuid.uuid4().hex[:10]
    return f"{prefix}-{tag}@pellwick.test", f"{prefix.title()} {tag}"


def outage(env_name: str) -> str:
    value = os.environ.get(env_name)
    assert value, f"the verifier must provide {env_name}"
    return value.rstrip("/")


def poll(check, expected: str, seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        threading.Event().wait(POLL_INTERVAL_S)
    pytest.fail(f"within {seconds}s expected: {expected}")


def wait_real(seconds: float, expected: str) -> None:
    target = time.monotonic() + seconds
    poll(lambda: time.monotonic() >= target, expected, seconds + POLL_S)


def seed_outline() -> list[dict]:
    return [
        {"ref": "cgb", "text": "Community garden build", "children": [
            {"ref": "sp", "text": "Site prep #soil", "children": [
                {"ref": "clear", "text": "Clear the lot", "date": "2026-11-07", "completed": True},
                {"ref": "ph", "text": "Test soil pH #soil @Mira"},
                {"ref": "bcopy", "mirrorOf": "buy"}]},
            {"ref": "pp", "text": "Planting plan", "children": [
                {"ref": "tom", "text": "Tomatoes #seedlings"},
                {"ref": "herb", "text": "Herb spiral @Jonah", "date": "2026-11-12"},
                {"ref": "wild", "text": "Native wildflowers #seedlings", "completed": True}]},
            {"ref": "vol", "text": "Volunteers", "children": [
                {"ref": "crew", "text": "Saturday crew @Mira"},
                {"ref": "tool", "text": "Tool library sign-out", "collapsed": True, "children": [
                    {"ref": "wheel", "text": "Borrow the wheelbarrow", "date": "2026-11-08"}]}]}]},
        {"ref": "we", "text": "Weekly errands", "children": [
            {"ref": "buy", "text": "Buy compost bags #soil"},
            {"ref": "ret", "text": "Return library books", "completed": True}]},
    ]


class World:
    def __init__(self, base, data, email, name, collab_email, collab_name):
        self.base = base
        self.ids: dict[str, str] = data["bullets"]
        self.shares: dict[str, dict] = data["shares"]
        self.users: dict[str, dict] = data["users"]
        self.email, self.name = email, name
        self.collab_email, self.collab_name = collab_email, collab_name

    def owner(self) -> httpx.Client:
        return login(self.base, self.email)

    def collab(self) -> httpx.Client:
        return login(self.base, self.collab_email)


def seed_world(base, *, outline=None, collab=False, share=None, share_status="accepted", hide=False) -> World:
    email, name = person("owner")
    collab_email, collab_name = person("collab")
    users = []
    if collab or share:
        users.append({"ref": "collab", "email": collab_email, "name": collab_name, "password": PASSWORD,
                      "confirmed": True, "outline": []})
    owner = {"ref": "owner", "email": email, "name": name, "password": PASSWORD, "confirmed": True,
             "hideCompleted": hide, "outline": seed_outline() if outline is None else outline}
    if share:
        owner["shares"] = [{"ref": "s1", "bullet": share, "email": collab_email, "status": share_status}]
    users.append(owner)
    r = httpx.post(base.rstrip("/") + "/api/grading/setup", json={"users": users},
                   headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_S)
    assert r.status_code == 201, f"POST /api/grading/setup answered {r.status_code}: {r.text[:300]}"
    return World(base, r.json(), email, name, collab_email, collab_name)


def bullet(c, bullet_id):
    r = c.get(f"/api/bullets/{bullet_id}")
    assert r.status_code == 200, f"GET /api/bullets/{bullet_id} answered {r.status_code}; expected 200"
    return r.json()["bullet"]


def outline(c, root=None):
    r = c.get("/api/outline", params={"root": root} if root else {})
    assert r.status_code == 200, f"GET /api/outline answered {r.status_code}; expected 200"
    return r.json()["bullets"]


def snapshot(c, root=None):
    return [(b["id"], b["parentId"], b["position"], b["text"], b["completed"], b["mirrorOf"])
            for b in outline(c, root)]


def shape(c):
    rows = outline(c)
    by = {b["id"]: b for b in rows}

    def depth(b):
        return 0 if b["parentId"] is None else 1 + depth(by[b["parentId"]])

    return [(b["text"], depth(b)) for b in rows]


def until_bullet(c, bullet_id, predicate, expected):
    def check():
        r = c.get(f"/api/bullets/{bullet_id}")
        return r.status_code == 200 and predicate(r.json()["bullet"])

    poll(check, expected)


def until_status(c, path, code, expected):
    poll(lambda: c.get(path).status_code == code, expected)


def mails_to(mail, email):
    addresses = _helper("addresses")
    return [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))]]


def mail_count(mail, email) -> int:
    return len(mails_to(mail, email))


def url_is(path: str):
    return re.compile(r"^https?://[^/]+" + re.escape(path) + r"/?(\?.*)?$")


@contextlib.contextmanager
def tab(browser, base, email, path="/", *, viewport=None, touch=False, reduced=False, before=None):
    cookie = login(base, email).cookies.get("twig_session") if email else None
    ctx = browser.new_context(viewport=viewport or DESKTOP, has_touch=touch, is_mobile=touch,
                              reduced_motion="reduce" if reduced else "no-preference", accept_downloads=True)
    try:
        if cookie:
            ctx.add_cookies([{"name": "twig_session", "value": cookie, "url": base}])
        page = ctx.new_page()
        if before:
            before(page)
        page.goto(base.rstrip("/") + path)
        yield page
    finally:
        ctx.close()


@contextlib.contextmanager
def clocked(browser, base, email, path="/", **options):
    cookie = login(base, email).cookies.get("twig_session") if email else None
    with _cm(open_app(browser, base.rstrip("/") + "/", **options)) as page:
        if cookie:
            page.context.add_cookies([{"name": "twig_session", "value": cookie, "url": base}])
        page.goto(base.rstrip("/") + path)
        yield page


def eventually(page, check, expected, steps=40):
    for _ in range(steps):
        try:
            check()
            return
        except AssertionError:
            advance(page, 250)
    pytest.fail(f"expected {expected}")


def another_tab(page, base, path="/"):
    other = page.context.new_page()
    other.goto(base.rstrip("/") + path)
    return other


def tree(page): return page.get_by_role("tree", name="Outline")
def row(page, bullet_id):
    return page.get_by_role("treeitem").and_(page.locator(f'[data-bullet-id="{bullet_id}"]')).first
def box(r): return r.get_by_role("textbox", name="Bullet text").first
def status(page): return page.get_by_role("status", name="Announcements").first
def alert(page): return page.get_by_role("alert", name="Problems").first
def searchbox(page): return page.get_by_role("searchbox", name="Search outline")


def ready(page):
    expect(tree(page)).to_be_visible(timeout=UI_MS)
    expect(tree(page)).not_to_have_attribute("aria-busy", "true", timeout=UI_MS)


def focus(page, bullet_id):
    box(row(page, bullet_id)).click()
    page.keyboard.press("End")
    expect(row(page, bullet_id)).to_have_attribute("aria-selected", "true", timeout=UI_MS)


def mark_no_reload(page):
    page.evaluate("() => { window.__twigNoReload = 1; }")


def assert_no_reload(page):
    assert page.evaluate("() => window.__twigNoReload === 1"), "the tab reloaded; expected in-place updates"


def has_ring(page, bullet_id) -> bool:
    r = row(page, bullet_id)
    return bool(r.evaluate(RING_JS)) or bool(box(r).evaluate(RING_JS))


def menu_dialog(page, name):
    return page.get_by_role("dialog", name=name)


def test_run_manifest_and_health(app_url):
    for base in (app_url, outage("APP_VALKEY_DOWN_URL"), outage("APP_MAILPIT_DOWN_URL")):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_S)
        assert r.status_code == 200, f"{base} health answered {r.status_code}"
        assert r.json() == {"status": "ok"}
        assert "application/json" in r.headers.get("content-type", "")


def test_grading_setup(app_url):
    base = app_url.rstrip("/")
    email, name = person("probe")
    body = {"users": [{"ref": "u", "email": email, "name": name, "password": PASSWORD, "confirmed": True,
                       "hideCompleted": True,
                       "outline": [{"ref": "g", "text": "Garden", "date": "2026-11-07", "children": [
                           {"ref": "c1", "text": "Clear", "completed": True}]},
                           {"ref": "gc", "mirrorOf": "g"}]}]}
    for headers, content in (({}, None), ({"X-Grading-Key": "wrong-" + GRADING_KEY}, None),
                             ({"X-Grading-Key": "wrong-" + GRADING_KEY}, b"{bad")):
        r = httpx.post(base + "/api/grading/setup", headers={**headers, **JSON_HEADERS},
                       content=content if content is not None else json.dumps(body), timeout=HTTP_S)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert httpx.post(base + "/api/session", json={"email": email, "password": PASSWORD},
                      timeout=HTTP_S).status_code == 401, "a refused setup must create nothing"
    r = httpx.post(base + "/api/grading/setup", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_S)
    assert r.status_code == 201
    data = r.json()
    ids = data["bullets"]
    assert isinstance(data["users"]["u"]["id"], str) and set(ids) == {"g", "c1", "gc"}
    c = login(base, email)
    me = c.get("/api/me").json()
    assert me["user"]["email"] == email and me["user"]["hideCompleted"] is True
    rows = c.get("/api/outline").json()["bullets"]
    assert [b["id"] for b in rows] == [ids["g"], ids["c1"], ids["gc"], ids["c1"]]
    assert rows[0]["text"] == f"Garden !({GD_DATE})" and rows[0]["date"] == GD_DATE
    assert rows[1]["completed"] is True and rows[2]["mirrorOf"] == ids["g"]
    again = httpx.post(base + "/api/grading/setup", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_S)
    assert again.status_code == 409 and again.json() == {
        "error": "email_taken", "message": "That email is already registered."}
    unconfirmed, uname = person("unconfirmed")
    r = httpx.post(base + "/api/grading/setup", json={"users": [
        {"ref": "u", "email": unconfirmed, "name": uname, "password": PASSWORD, "confirmed": False}]},
        headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_S)
    assert r.status_code == 201
    sharer, sname = person("sharer")
    guest, gname = person("invitee")
    two = {"users": [
        {"ref": "owner", "email": sharer, "name": sname, "password": PASSWORD, "confirmed": True,
         "outline": [{"ref": "b", "text": "Branch"}], "shares": [
             {"ref": "s1", "bullet": "b", "email": guest, "status": "sent"},
             {"ref": "s2", "bullet": "b", "email": guest + ".x", "status": "sent"}]},
    ]}
    r = httpx.post(base + "/api/grading/setup", json=two, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_S)
    assert r.status_code == 201
    share = r.json()["shares"]["s1"]
    assert isinstance(share["id"], str) and isinstance(share["token"], str) and share["token"]
    assert httpx.post(base + "/api/session", json={"email": unconfirmed, "password": PASSWORD},
                      timeout=HTTP_S).status_code == 401, "an unconfirmed account cannot sign in"
    inv = httpx.get(base + f"/api/invitations/{share['token']}", timeout=HTTP_S)
    assert inv.status_code == 200 and inv.json()["email"] == guest and inv.json()["bulletText"] == "Branch"
    w = seed_world(base, share="cgb")
    shared = w.collab().get("/api/me").json()["shared"]
    assert [s["bulletId"] for s in shared] == [w.ids["cgb"]] and shared[0]["text"] == T["cgb"]


def test_error_order_and_boundary(app_url):
    base = app_url.rstrip("/")
    w, other = seed_world(base), seed_world(base)
    c, oi, i = w.owner(), other.ids, w.ids
    anon = client(base)
    codes: list[int] = []

    def expect_json(r, code, body=None):
        codes.append(r.status_code)
        assert r.status_code == code, f"{r.request.method} {r.request.url} answered {r.status_code}; expected {code}"
        if body is not None:
            assert r.json() == body

    padded = {"name": "x", "email": "nope", "password": "p", "pad": ""}
    room = BODY_LIMIT - len(json.dumps(padded, separators=(",", ":")).encode())
    padded["pad"] = "a" * room
    raw = json.dumps(padded, separators=(",", ":")).encode()
    assert len(raw) == BODY_LIMIT
    r = anon.post("/api/signup", content=raw, headers=JSON_HEADERS)
    expect_json(r, 422)
    assert "errors" in r.json(), "exactly the size limit is allowed and then validated"
    expect_json(anon.post("/api/signup", content=raw + b" ", headers=JSON_HEADERS), 413, {"error": "too_large"})
    expect_json(anon.post("/api/bullets", content=raw + b" ", headers=JSON_HEADERS), 413, {"error": "too_large"})
    plain = {"Content-Type": "text/plain"}
    expect_json(anon.post("/api/bullets", content=b"hello", headers=plain), 415, {"error": "unsupported_media_type"})
    expect_json(anon.post("/api/signup", content=b"hello", headers=plain), 415, {"error": "unsupported_media_type"})
    expect_json(anon.get("/api/outline"), 401, {"error": "unauthenticated"})
    expect_json(anon.post("/api/bullets", json={"parentId": None, "afterId": None, "text": ""}), 401,
                {"error": "unauthenticated"})
    nf = {"error": "not_found"}
    expect_json(c.patch(f"/api/bullets/{oi['tom']}", json={}), 404, nf)
    expect_json(c.post("/api/bullets", json={"parentId": oi["cgb"], "afterId": None, "text": ""}), 404, nf)
    expect_json(c.get("/api/outline", params={"root": oi["cgb"]}), 404, nf)
    expect_json(c.get("/api/search", params={"q": "soil", "root": oi["cgb"]}), 404, nf)
    expect_json(c.post(f"/api/bullets/{i['tom']}/move", json={"parentId": oi["sp"], "index": 0}), 404, nf)
    expect_json(c.get(f"/api/bullets/missing-{uuid.uuid4().hex[:8]}"), 404, nf)
    expect_json(c.patch(f"/api/bullets/{i['tom']}", content=b"{bad", headers=JSON_HEADERS), 422,
                {"errors": {"body": "Send a JSON object."}})
    expect_json(c.patch(f"/api/bullets/{i['tom']}", content=b"[]", headers=JSON_HEADERS), 422,
                {"errors": {"body": "Send a JSON object."}})
    r = c.patch(f"/api/bullets/{i['tom']}", json={"text": "No revision"})
    expect_json(r, 422)
    assert "revision" in r.json()["errors"]
    rev = bullet(c, i["tom"])["revision"]
    expect_json(c.patch(f"/api/bullets/{i['tom']}", json={"text": "a" * TEXT_MAX, "revision": rev}), 200)
    rev = bullet(c, i["tom"])["revision"]
    r = c.patch(f"/api/bullets/{i['tom']}", json={"text": "a" * (TEXT_MAX + 1), "revision": rev})
    expect_json(r, 422)
    assert "text" in r.json()["errors"]
    expect_json(c.patch(f"/api/bullets/{i['tom']}", json={"text": "stale", "revision": rev - 1}), 409)
    expect_json(anon.get(f"/api/nope-{uuid.uuid4().hex[:8]}"), 404, nf)
    shell = anon.get(f"/nowhere-{uuid.uuid4().hex[:8]}")
    assert shell.status_code == 200 and "application/json" not in shell.headers.get("content-type", "")
    for hidden in ("/run.json", "/package-lock.json", "/.env"):
        text = anon.get(hidden).text
        assert "run-manifest-v1" not in text and "DATABASE_URL" not in text
        assert not text.lstrip().startswith("{"), f"{hidden} must not serve a JSON file"
    cookie = httpx.post(base + "/api/session", json={"email": w.email, "password": PASSWORD}, timeout=HTTP_S)
    header = cookie.headers.get("set-cookie", "").lower()
    assert "twig_session" + "=" in header and "HttpOnly".lower() in header and "SameSite=Lax".lower() in header
    assert 403 not in codes, "the API never answers 403"


HERO_DECLARED_ONSETS_JS = """(root, texts) => texts.map(text => {
  const item = [...root.querySelectorAll('[role=listitem], li')].find(el => el.textContent.trim() === text);
  if (!item) return null;
  const delays = [item, ...item.querySelectorAll('*')].flatMap(node => node.getAnimations())
    .map(anim => anim.effect ? anim.effect.getComputedTiming().delay : null).filter(ms => ms !== null && !Number.isNaN(ms));
  return delays.length ? Math.round(Math.min(...delays)) : null;
})"""


def test_hero_demo_motion(browser, app_url):
    base = app_url.rstrip("/")
    demo = ["Prepare the site", "Clear the lot", "Test the soil", "Plant the beds", "Tomatoes", "Herb spiral",
            "Find helpers", "Saturday crew"]
    children = ["Clear the lot", "Test the soil", "Tomatoes", "Herb spiral", "Saturday crew"]
    parents = ["Prepare the site", "Plant the beds", "Find helpers"]

    def region(page): return page.get_by_role("region", name="Outline demo")
    def left(page, text): return region(page).get_by_text(text, exact=True).bounding_box()["x"]

    with _cm(open_app(browser, base + "/")) as page:
        region(page).scroll_into_view_if_needed()
        nest = region(page).get_by_role("button", name="Nest it")
        expect(nest).to_have_attribute("aria-disabled", "true")
        until(page, NEST_READY_JS, seconds=HERO_TYPING_MAX_S)
        expect(region(page).get_by_role("listitem")).to_have_text(demo)
        expect(nest).to_have_attribute("aria-pressed", "false")
        assert len({round(left(page, t)) for t in demo}) == 1, "the typed list is flat"
        flat_weight = int(region(page).get_by_text(parents[0], exact=True).evaluate(
            "el => getComputedStyle(el).fontWeight"))
        start_x = {t: left(page, t) for t in children}
        nest.click()
        declared = region(page).evaluate(HERO_DECLARED_ONSETS_JS, children)
        onsets: dict[str, int] = {}
        for step in range(1, HERO_SAMPLE_STEPS):
            advance(page, HERO_STEP_MS)
            for child in children:
                if child not in onsets and left(page, child) > start_x[child] + 1:
                    onsets[child] = step
        advance(page, 1500)
        expect(nest).to_have_attribute("aria-pressed", "true")
        for child in children:
            assert left(page, child) > left(page, parents[0]), f"{child} nests under its parent"
        nested_weight = int(region(page).get_by_text(parents[0], exact=True).evaluate(
            "el => getComputedStyle(el).fontWeight"))
        assert nested_weight >= 600 > flat_weight, "parents turn semi-bold"
        assert len(onsets) == len(children), f"every child slides right after Nest it, moved: {sorted(onsets)}"
        order = [onsets[c] for c in children]
        staggered = lambda xs: None not in xs and xs == sorted(xs) and len(set(xs)) >= 3
        assert staggered(order) or staggered(declared), \
            f"children must start one after another, got clock steps {order} and declared starts {declared}"
        nest.click()
        advance(page, 1500)
        expect(nest).to_have_attribute("aria-pressed", "false")
        assert len({round(left(page, t)) for t in demo}) == 1, "pressing again flattens the list"

    with _cm(open_app(browser, base + "/", reduced_motion="reduce")) as page:
        expect(region(page).get_by_role("listitem")).to_have_text(demo)
        nest = region(page).get_by_role("button", name="Nest it")
        assert nest.get_attribute("aria-disabled") != "true", "Nest it is enabled at once under reduced motion"
        nest.click()
        for child in children:
            assert left(page, child) > left(page, parents[0]), "nesting swaps instantly"
        running = region(page).get_by_role("list").evaluate(
            "el => document.getAnimations().filter(a => a.effect && a.effect.target && el.contains(a.effect.target)"
            " && a.playState === 'running').length")
        assert running == 0, "no list animation runs under reduced motion (pill hover is allowed)"


def test_marketing_seed_components(browser, app_url):
    base = app_url.rstrip("/")
    with tab(browser, base, None, "/") as page:
        pill = page.get_by_role("link", name="Start your outline").first
        expect(pill).to_be_visible(timeout=UI_MS)
        bar_height = pill.evaluate(
            "el => { let n = el; while (n) { if (getComputedStyle(n).position === 'sticky') "
            "return n.getBoundingClientRect().height; n = n.parentElement; } return -1; }")
        assert abs(bar_height - TOP_BAR_PX) <= 1, f"the outline top bar is sticky and 64 px tall, got {bar_height}"
        expect(page.get_by_text("Twigline", exact=True).first).to_be_visible()
        assert urlparse(pill.get_attribute("href") or "").path == "/signup"
        email_pill = page.get_by_role("link", name="Sign in with email").first
        expect(email_pill).to_be_visible()
        assert urlparse(email_pill.get_attribute("href") or "").path == "/signin"
        rest, hover = state_styles(pill, "background-color")
        assert rest != hover, "the sky pill button deepens on hover"
        canvas = page.locator("canvas").first
        expect(canvas).to_be_visible()
        assert decode(capture(canvas)).variance() > 0, "the dot-field canvas is drawn"
        expect(page.get_by_text("Every move has a key", exact=True).first).to_be_visible()
        tablist = page.get_by_role("tablist", name="Demo views")
        tablist.scroll_into_view_if_needed()
        for name in ("List", "Board", "Tasks", "Plain text"):
            expect(tablist.get_by_role("tab", name=name)).to_be_visible()
        before = tablist.get_by_role("tab", selected=True).inner_text()
        page.get_by_role("button", name="Next view").click()
        poll(lambda: tablist.get_by_role("tab", selected=True).inner_text() != before,
             "Next view selects another tab of the view switcher")
        for quote in ("I keep the whole allotment plan in one list and zoom into this week's jobs.",
                      "Chapters, scenes and beats, nested the way I actually think.",
                      "I shared one branch with my lab partner and nothing else."):
            expect(page.get_by_text(quote)).to_be_visible()
        for who in ("Ines Varga", "Tomasz Lind", "Priya Nandakumar"):
            expect(page.get_by_text(who).first).to_be_visible()
        expect(page.get_by_text("Press Alt and an arrow key to zoom into or out of any bullet.")).to_be_visible()
        expect(page.get_by_role("link", name="See every key →")).to_be_visible()
        for tile in ("Plain text", "Markdown", "OPML"):
            assert page.get_by_text(tile, exact=True).count() >= 1, f"download tile {tile}"
        expect(page.get_by_text("Your next plan already has branches.")).to_be_visible()
        for column in ("Twigline", "Outlining", "Sharing", "Downloads", "Pellwick & Ash"):
            expect(page.get_by_text(column, exact=True).last).to_be_visible()
    with tab(browser, base, None, "/", viewport=PHONE, touch=True) as page:
        expect(page.get_by_role("button", name="Menu")).to_be_visible(timeout=UI_MS)


@pytest.mark.parametrize("name", ["phone", "tablet", "desktop"], ids=["phone", "tablet", "desktop"])
def test_three_viewports(browser, app_url, name):
    base = app_url.rstrip("/")
    vp, touch = VIEWPORTS[name], name == "phone"
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, None, "/", viewport=vp, touch=touch) as page:
        expect(page.get_by_role("link", name="Start your outline").first).to_be_visible(timeout=UI_MS)
        layout(page)
        page.goto(base + "/signup")
        expect(page.get_by_role("textbox", name="Name")).to_be_visible(timeout=UI_MS)
        layout(page)
    with tab(browser, base, w.email, "/", viewport=vp, touch=touch) as page:
        ready(page)
        layout(page)
        page.goto(base + f"/b/{i['cgb']}?view=board")
        expect(page.get_by_role("region", name=T["sp"])).to_be_visible(timeout=UI_MS)
        layout(page)
        page.goto(base + f"/b/{i['pp']}")
        ready(page)
        page.get_by_role("button", name="Share", exact=True).click()
        expect(menu_dialog(page, "Share bullet")).to_be_visible(timeout=UI_MS)
        layout(page)
        page.goto(base + f"/b/missing-{uuid.uuid4().hex[:8]}")
        expect(page.get_by_role("heading", name="We couldn't find that bullet")).to_be_visible(timeout=UI_MS)
        layout(page)


def _ws(page, root, since, stop_type, want, deadline=LIVE_MS * 5):
    return page.evaluate(WS_JS, [root, since, stop_type, want, deadline])


def test_live_changes_in_order(browser, app_url, valkey):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    seq0 = c.get("/api/outline", params={"root": i["cgb"]}).json()["seq"]
    targets = [i["tom"], i["herb"], i["crew"]]
    seqs = []
    for target in targets:
        r = c.patch(f"/api/bullets/{target}", json={"completed": True})
        assert r.status_code == 200
        seqs.append(r.json()["seq"])
    assert seqs == [seq0 + 1, seq0 + 2, seq0 + 3], "sequence numbers have no gaps and no repeats"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        out = _ws(page, i["cgb"], seq0, "change", 3)
        changes = [m for m in out if m["type"] == "change"]
        assert [m["seq"] for m in changes] == seqs
        for m, target in zip(changes, targets):
            assert any(b["id"] == target and b["completed"] is True for b in m["bullets"])
        out = _ws(page, i["cgb"], seq0 + 1, "change", 2)
        assert [m["seq"] for m in out if m["type"] == "change"] == seqs[1:]
        beat = _ws(page, i["cgb"], seqs[-1], "heartbeat", 1, HEARTBEAT_WAIT_MS)
        assert any(m["type"] == "heartbeat" and m["fanout"] == "ok" for m in beat)
    key = f"twig:outline:{w.users['owner']['id']}:changes"
    entries = valkey.command("XRANGE", key, "-", "+")

    def text_of(v): return v.decode() if isinstance(v, bytes) else str(v)

    by_id = {text_of(e[0]): e[1] for e in entries}
    assert f"{seqs[-1]}-0" in by_id, "the stream entry id is <seq>-0"
    fields = [text_of(v) for v in by_id[f"{seqs[-1]}-0"]]
    record = dict(zip(fields[0::2], fields[1::2]))
    assert json.loads(record["change"])["seq"] == seqs[-1] and record["seq"] == str(seqs[-1])


def test_live_sync_paused(browser, app_url):
    down = outage("APP_VALKEY_DOWN_URL")
    w = seed_world(down)
    i = w.ids
    c = login(down, w.email)
    with tab(browser, down, w.email, f"/b/{i['cgb']}") as page:
        ready(page)
        banner = page.get_by_role("region", name="Live sync")
        expect(banner).to_contain_text(
            "Live sync paused. Your edits are saved and other tabs will catch up when it returns.", timeout=UI_MS)
        expect(banner.get_by_role("button", name="Reload branch")).to_be_visible()
        beat = _ws(page, i["cgb"], 0, "heartbeat", 1, HEARTBEAT_WAIT_MS)
        assert any(m["type"] == "heartbeat" and m["fanout"] == "paused" for m in beat)
        focus(page, i["tom"])
        page.keyboard.type(" saved")
        page.keyboard.press("Escape")
        until_bullet(c, i["tom"], lambda b: b["text"] == "Tomatoes #seedlings saved", "an edit saves while paused")
        r = c.patch(f"/api/bullets/{i['herb']}", json={"completed": True})
        assert r.status_code == 200
        banner.get_by_role("button", name="Reload branch").click()
        ready(page)


def test_live_reload_after_trim(browser):
    short = outage("APP_SHORT_URL")
    w = seed_world(short)
    i, c = w.ids, w.owner()
    seq0 = c.get("/api/outline", params={"root": i["cgb"]}).json()["seq"]
    for k in range(SHORT_STREAM_MAXLEN + 2):
        assert c.patch(f"/api/bullets/{i['tom']}", json={"completed": k % 2 == 0}).status_code == 200
    with tab(browser, short, w.email, "/") as page:
        ready(page)
        out = _ws(page, i["cgb"], seq0, "reload", 1)
        assert [m for m in out if m["type"] != "heartbeat"][:1] == [{"type": "reload"}]


def _fill_signup(page, name, email, password=PASSWORD):
    page.get_by_role("textbox", name="Name").fill(name)
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password").fill(password)


def test_wf_outline_keyboard_signup(browser, app_url, mail):
    base = app_url.rstrip("/")
    email, name = person("newbie")
    with tab(browser, base, None, "/") as page:
        page.get_by_role("link", name="Start your outline").first.click()
        expect(page).to_have_url(url_is("/signup"), timeout=UI_MS)
        page.get_by_role("button", name="Send code").click()
        for copy in ("Enter your name.", "Enter a valid email address.", "Use at least 10 characters."):
            expect(page.get_by_text(copy)).to_be_visible(timeout=UI_MS)
        _fill_signup(page, name, email)
        with _cm(held(page, "**/api/signup")) as hold:
            page.get_by_role("button", name="Send code").click()
            pending = page.get_by_role("button", name="Sending")
            expect(pending).to_be_disabled()
            expect(pending).to_have_attribute("aria-busy", "true")
            expect(status(page)).not_to_contain_text("We sent a 6-digit code")
            hold.release()
        expect(status(page)).to_contain_text(f"We sent a 6-digit code to {email}.", timeout=UI_MS)
        messages = mails_to(mail, email)
        assert len(messages) == 1, "exactly one code message reached Mailpit"
        subject = messages[0].get("Subject", "")
        found = re.fullmatch(r"Your Twigline code is (\d{6})", subject)
        assert found, f"subject {subject!r}"
        code = found.group(1)
        body = _helper("text")(messages[0])
        assert code in body and f"{CODE_MINUTES} minutes" in body
        assert httpx.post(base + "/api/session", json={"email": email, "password": PASSWORD},
                          timeout=HTTP_S).status_code == 401, "unconfirmed accounts cannot sign in"
        wrong = "000000" if code != "000000" else "111111"
        field = page.get_by_role("textbox", name="Confirmation code")
        field.fill(wrong)
        page.get_by_role("button", name="Confirm").click()
        expect(page.get_by_text("That code doesn't match. Check the latest email.")).to_be_visible(timeout=UI_MS)
        field.fill(code)
        page.get_by_role("button", name="Confirm").click()
        expect(page.get_by_text("Your outline is empty. Start with one thought.")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("button", name="Add first bullet")).to_be_visible()
        me = page.context.request.get(base + "/api/me")
        assert me.json()["user"]["email"] == email
    assert login(base, email).get("/api/outline").json()["bullets"] == []


def test_wf_outline_keyboard_build(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, outline=[])
    c = w.owner()
    with tab(browser, base, w.email, "/") as page:
        expect(page.get_by_text("Your outline is empty. Start with one thought.")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="Add first bullet").click()
        kb = page.keyboard
        kb.type("Garden")
        kb.press("Enter")
        kb.type("Beds")
        kb.press("Tab")
        kb.press("Enter")
        kb.type("Tomatoes")
        kb.press("Tab")
        kb.press("Enter")
        kb.type(WATER)
        kb.press("Shift+Tab")
        selected = page.get_by_role("treeitem", selected=True)
        expect(selected).to_have_count(1, timeout=UI_MS)
        expect(selected).to_have_accessible_name(WATER)
        assert selected.evaluate(RING_JS) or box(selected).evaluate(RING_JS), "the focused bullet shows a focus ring"
        kb.press("ArrowUp")
        tomatoes = page.get_by_role("treeitem", name="Tomatoes", exact=True)
        expect(tomatoes).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        assert tomatoes.evaluate(RING_JS) or box(tomatoes).evaluate(RING_JS)
        kb.press("ArrowDown")
        expect(page.get_by_role("treeitem", name=WATER, exact=True)).to_have_attribute("aria-selected", "true")
        expected = [("Garden", 0), ("Beds", 1), ("Tomatoes", 2), (WATER, 1)]
        poll(lambda: shape(c) == expected, f"the server holds {expected}")
        page.reload()
        ready(page)
        for text, depth in expected:
            expect(page.get_by_role("treeitem", name=text, exact=True)).to_have_attribute(
                "data-depth", str(depth), timeout=UI_MS)


def test_wf_outline_keyboard_mail_down(browser, app_url, mail):
    down = outage("APP_MAILPIT_DOWN_URL")
    email, name = person("nomail")
    r = httpx.post(down + "/api/signup", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_S)
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    other, other_name = person("nomailui")
    with tab(browser, down, None, "/signup") as page:
        _fill_signup(page, other_name, other)
        page.get_by_role("button", name="Send code").click()
        expect(alert(page)).to_contain_text("We couldn't send your code right now. Try again in a minute.",
                                            timeout=UI_MS)
        expect(status(page)).not_to_contain_text("We sent a 6-digit code")
    assert mail_count(mail, email) == 0 and mail_count(mail, other) == 0


@pytest.mark.timeout(180)
def test_wf_outline_keyboard_code_expired(app_url, mail):
    short = outage("APP_SHORT_URL")
    email, name = person("slowcode")
    r = httpx.post(short + "/api/signup", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_S)
    assert r.status_code == 202 and r.json() == {"status": "code_sent"}
    subject = mails_to(mail, email)[0].get("Subject", "")
    code = re.fullmatch(r"Your Twigline code is (\d{6})", subject).group(1)
    wrong = "000000" if code != "000000" else "111111"
    r = httpx.post(short + "/api/signup/confirm", json={"email": email, "code": wrong}, timeout=HTTP_S)
    assert r.status_code == 422 and r.json()["errors"]["code"] == "That code doesn't match. Check the latest email."
    wait_real(SHORT_CODE_S + 1, "the code lifetime has passed")
    r = httpx.post(short + "/api/signup/confirm", json={"email": email, "code": code}, timeout=HTTP_S)
    assert r.status_code == 422 and r.json()["errors"]["code"] == "That code has expired. Send a new one."
    assert httpx.post(short + "/api/session", json={"email": email, "password": PASSWORD},
                      timeout=HTTP_S).status_code == 401


def test_same_reply_for_taken_addresses(browser, app_url, mail):
    base = app_url.rstrip("/")
    w = seed_world(base)
    fresh, fresh_name = person("fresh")
    new = httpx.post(base + "/api/signup", json={"name": fresh_name, "email": fresh, "password": PASSWORD},
                     timeout=HTTP_S)
    taken = httpx.post(base + "/api/signup", json={"name": "Someone Else", "email": w.email,
                                                   "password": "another-long-pass"}, timeout=HTTP_S)
    assert new.status_code == taken.status_code == 202
    assert new.json() == taken.json() == {"status": "code_sent"}
    new_mail, taken_mail = mails_to(mail, fresh), mails_to(mail, w.email)
    assert len(new_mail) == 1 and len(taken_mail) == 1
    assert re.fullmatch(r"Your Twigline code is \d{6}", new_mail[0].get("Subject", ""))
    assert taken_mail[0].get("Subject") == "Someone tried to sign up with your email"
    assert "/signin" in _helper("text")(taken_mail[0])
    assert httpx.post(base + "/api/session", json={"email": w.email, "password": PASSWORD},
                      timeout=HTTP_S).status_code == 200
    assert httpx.post(base + "/api/session", json={"email": w.email, "password": "another-long-pass"},
                      timeout=HTTP_S).status_code == 401
    shown = []
    for email in (person("uifresh")[0], w.email):
        earlier = mail_count(mail, email)
        with tab(browser, base, None, "/signup") as page:
            _fill_signup(page, "Same Reply", email)
            page.get_by_role("button", name="Send code").click()
            expect(status(page)).to_contain_text(f"We sent a 6-digit code to {email}.", timeout=UI_MS)
            shown.append(page.get_by_role("textbox", name="Confirmation code").is_visible())
        assert mail_count(mail, email) == earlier + 1
    assert shown == [True, True]


def test_tree_attributes(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        expect(tree(page)).to_have_attribute("data-zoom-root", "home")
        expect(page.get_by_role("heading", level=1)).to_have_text("Home")
        cases = {"cgb": (1, 0, "true", "false", "false"), "sp": (2, 1, "true", "false", "false"),
                 "clear": (3, 2, None, "false", "true"), "tool": (3, 2, "false", "true", "false"),
                 "we": (1, 0, "true", "false", "false")}
        for ref, (level, depth, expanded, collapsed, completed) in cases.items():
            r = row(page, i[ref])
            expect(r).to_have_accessible_name(T[ref])
            expect(r).to_have_attribute("aria-level", str(level))
            expect(r).to_have_attribute("data-depth", str(depth))
            expect(r).to_have_attribute("data-collapsed", collapsed)
            expect(r).to_have_attribute("data-completed", completed)
            expect(r).to_have_attribute("aria-selected", "false")
            assert r.get_attribute("aria-expanded") == expanded, f"aria-expanded on {ref}"
            assert r.get_attribute("data-mirror-of") is None
        copy = row(page, i["bcopy"])
        expect(copy).to_have_attribute("data-mirror-of", i["buy"])
        expect(copy).to_have_accessible_name(T["buy"])
        dot = page.get_by_role("link", name=f"Zoom into {T['pp']}")
        assert urlparse(dot.get_attribute("href") or "").path == f"/b/{i['pp']}"
        toggle = page.get_by_role("button", name=f"Toggle children of {T['pp']}")
        expect(toggle).to_have_attribute("aria-expanded", "true")
        focus(page, i["tom"])
        expect(row(page, i["tom"])).to_have_attribute("aria-selected", "true")
        expect(row(page, i["herb"])).to_have_attribute("aria-selected", "false")
        page.goto(base + f"/b/{i['pp']}")
        ready(page)
        expect(tree(page)).to_have_attribute("data-zoom-root", i["pp"])
        expect(row(page, i["tom"])).to_have_attribute("aria-level", "1")
        expect(row(page, i["tom"])).to_have_attribute("data-depth", "2")


def test_backspace_on_empty_bullet(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, outline=[{"ref": "a", "text": "Alpha"}])
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["a"])
        page.keyboard.press("Enter")
        poll(lambda: len(outline(c)) == 2, "Enter adds an empty sibling")
        expect(page.get_by_role("treeitem", selected=True)).to_have_accessible_name("Untitled", timeout=UI_MS)
        page.keyboard.press("Backspace")
        expect(status(page)).to_contain_text("Deleted empty bullet", timeout=UI_MS)
        page.keyboard.type("Z")
        page.keyboard.press("Escape")
        until_bullet(c, i["a"], lambda b: b["text"] == "AlphaZ", "the caret sat at the end of the bullet above")
        poll(lambda: len(outline(c)) == 1, "the empty bullet is gone")
    empty = c.post("/api/bullets", json={"parentId": None, "afterId": i["a"], "text": ""}).json()["bullet"]["id"]
    kid = c.post("/api/bullets", json={"parentId": empty, "afterId": None, "text": CHILD_TEXT}).json()["bullet"]["id"]
    before = snapshot(c)
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        box(row(page, empty)).click()
        page.keyboard.press("Backspace")
        expect(alert(page)).to_contain_text(
            "Can't delete with Backspace: this bullet has bullets inside. Press Ctrl+Shift+Backspace to delete it.",
            timeout=UI_MS)
        expect(row(page, empty)).to_be_visible()
    assert bullet(c, empty)["childCount"] == 1 and bullet(c, kid)["text"] == CHILD_TEXT
    assert snapshot(c) == before


def test_moving_with_children(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["tom"])
        page.keyboard.press("Control+ArrowUp")
        expect(status(page)).to_contain_text("Moved to position 4 of 4 under Site prep #soil", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"] and b["position"] == 3, "crossed into Site prep")
        expect(row(page, i["tom"])).to_have_attribute("aria-selected", "true")
        focus(page, i["pp"])
        page.keyboard.press("Control+ArrowDown")
        expect(status(page)).to_contain_text("Moved to position 3 of 3 under Community garden build", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["parentId"] == i["cgb"] and b["position"] == 2, "swapped down")
        assert bullet(c, i["herb"])["parentId"] == i["pp"], "children move with their bullet"
        page.keyboard.press("Control+ArrowUp")
        expect(status(page)).to_contain_text("Moved to position 2 of 3 under Community garden build", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["position"] == 1, "swapped up")
        focus(page, i["we"])
        page.keyboard.press("Control+ArrowUp")
        expect(status(page)).to_contain_text("Moved to position 1 of 2 at top level", timeout=UI_MS)
        until_bullet(c, i["we"], lambda b: b["parentId"] is None and b["position"] == 0, "top-level move")
    r = c.post(f"/api/bullets/{i['wild']}/move", json={"op": "down"})
    assert r.status_code == 200 and r.json()["bullet"]["parentId"] == i["vol"] and r.json()["bullet"]["position"] == 0


def test_move_refusals_at_the_ends(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    before = snapshot(c)
    up = "Can't move up: it is already first."
    down = "Can't move down: it is already last."
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["cgb"])
        page.keyboard.press("Control+ArrowUp")
        expect(alert(page)).to_contain_text(up, timeout=UI_MS)
        focus(page, i["we"])
        page.keyboard.press("Control+ArrowDown")
        expect(alert(page)).to_contain_text(down, timeout=UI_MS)
        page.goto(base + f"/b/{i['cgb']}")
        ready(page)
        focus(page, i["sp"])
        page.keyboard.press("Control+ArrowUp")
        expect(alert(page)).to_contain_text(up, timeout=UI_MS)
        focus(page, i["vol"])
        page.keyboard.press("Control+ArrowDown")
        expect(alert(page)).to_contain_text(down, timeout=UI_MS)
    assert snapshot(c) == before
    for target, op, code, message in ((i["cgb"], "up", "at_first", up), (i["we"], "down", "at_last", down),
                                      (i["sp"], "up", "at_first", up), (i["ret"], "down", "at_last", down)):
        r = c.post(f"/api/bullets/{target}/move", json={"op": op})
        assert r.status_code == 409 and r.json() == {"error": code, "message": message}
    assert snapshot(c) == before


def test_wf_move_across_second_tab(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        focus(page, i["pp"])
        page.keyboard.press("Control+ArrowDown")
        until_bullet(c, i["pp"], lambda b: b["position"] == 2, "the move is saved")
        other.wait_for_function(ORDER_JS, arg=[i["vol"], i["pp"]], timeout=LIVE_MS)
        assert_no_reload(other)


def test_wf_move_across_second_tab_crossing(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        focus(page, i["tom"])
        page.keyboard.press("Control+ArrowUp")
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"], "the crossing move is saved")
        other.wait_for_function(INSIDE_JS, arg=[i["sp"], i["tom"]], timeout=LIVE_MS)
        assert_no_reload(other)


def test_wf_move_across_down_into_collapsed(browser, app_url):
    base = app_url.rstrip("/")
    tree_seed = seed_outline()
    tree_seed[0]["children"][2]["collapsed"] = True
    w = seed_world(base, outline=tree_seed)
    i, c = w.ids, w.owner()
    assert bullet(c, i["vol"])["collapsed"] is True
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        expect(row(other, i["vol"])).to_have_attribute("aria-expanded", "false", timeout=UI_MS)
        expect(row(other, i["crew"])).not_to_be_visible()
        focus(page, i["wild"])
        page.keyboard.press("Control+ArrowDown")
        expect(status(page)).to_contain_text(f"Moved to position 1 of 3 under {T['vol']}", timeout=UI_MS)
        expect(row(page, i["wild"])).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        until_bullet(c, i["wild"], lambda b: b["parentId"] == i["vol"] and b["position"] == 0,
                     "the last child of Planting plan moved to the start of Volunteers")
        until_bullet(c, i["vol"], lambda b: b["collapsed"] is False, "the collapsed next parent is expanded")
        assert bullet(c, i["crew"])["position"] == 1 and bullet(c, i["pp"])["childCount"] == 2
        expect(row(other, i["vol"])).to_have_attribute("aria-expanded", "true", timeout=LIVE_MS)
        other.wait_for_function(INSIDE_JS, arg=[i["vol"], i["wild"]], timeout=LIVE_MS)
        other.wait_for_function(ORDER_JS, arg=[i["wild"], i["crew"]], timeout=LIVE_MS)
        expect(row(other, i["wild"])).to_have_attribute("data-depth", "2")
        assert_no_reload(other)
        page.reload()
        ready(page)
        expect(row(page, i["vol"])).to_have_attribute("data-collapsed", "false", timeout=UI_MS)
        page.wait_for_function(INSIDE_JS, arg=[i["vol"], i["wild"]], timeout=UI_MS)
        page.wait_for_function(ORDER_JS, arg=[i["wild"], i["crew"]], timeout=UI_MS)


def test_indent_and_outdent(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["herb"])
        page.keyboard.press("Shift+Tab")
        expect(status(page)).to_contain_text("Outdented under Community garden build", timeout=UI_MS)
        until_bullet(c, i["herb"], lambda b: b["parentId"] == i["cgb"] and b["position"] == 2, "outdented after pp")
        until_bullet(c, i["wild"], lambda b: b["parentId"] == i["pp"] and b["position"] == 1, "later sibling stays")
        expect(row(page, i["herb"])).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Tab")
        expect(status(page)).to_contain_text("Indented under Planting plan", timeout=UI_MS)
        until_bullet(c, i["herb"], lambda b: b["parentId"] == i["pp"] and b["position"] == 2, "indented as last child")
        focus(page, i["we"])
        page.keyboard.press("Tab")
        expect(status(page)).to_contain_text("Indented under Community garden build", timeout=UI_MS)
        until_bullet(c, i["we"], lambda b: b["parentId"] == i["cgb"] and b["position"] == 3, "last child of cgb")
        page.keyboard.press("Shift+Tab")
        expect(status(page)).to_contain_text("Outdented to top level", timeout=UI_MS)
        until_bullet(c, i["we"], lambda b: b["parentId"] is None and b["position"] == 1, "top level after cgb")


def test_indent_and_outdent_refusals(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    before = snapshot(c)
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["cgb"])
        page.keyboard.press("Tab")
        expect(alert(page)).to_contain_text("Can't indent: there is no bullet above it at this level.", timeout=UI_MS)
        focus(page, i["we"])
        page.keyboard.press("Shift+Tab")
        expect(alert(page)).to_contain_text("Can't outdent: it is already at the top level.", timeout=UI_MS)
        page.goto(base + f"/b/{i['cgb']}")
        ready(page)
        focus(page, i["sp"])
        page.keyboard.press("Shift+Tab")
        expect(alert(page)).to_contain_text("Can't outdent: it is already at the top level.", timeout=UI_MS)
    assert snapshot(c) == before
    r = c.post(f"/api/bullets/{i['cgb']}/move", json={"op": "indent"})
    assert r.status_code == 409 and r.json() == {
        "error": "no_previous_sibling",
        "message": "Can't indent: there is no bullet above it at this level."}
    r = c.post(f"/api/bullets/{i['we']}/move", json={"op": "outdent"})
    assert r.status_code == 409 and r.json() == {
        "error": "at_top", "message": "Can't outdent: it is already at the top level."}
    assert snapshot(c) == before

    short = outage("APP_SHORT_URL")
    deep = [{"ref": "l1", "text": "Level one", "children": [{"ref": "l2", "text": "Level two", "children": [
        {"ref": "l3", "text": "Level three", "children": [
            {"ref": "l4", "text": "Level four"}, {"ref": "ex", "text": "Extra"}]},
        {"ref": "x", "text": "Excess"}]}]}]
    s = seed_world(short, outline=deep)
    sc, si = s.owner(), s.ids
    message = f"Can't indent: an outline goes at most {SHORT_MAX_DEPTH} levels deep."
    r = sc.post(f"/api/bullets/{si['ex']}/move", json={"op": "indent"})
    assert r.status_code == 409 and r.json() == {"error": "too_deep", "message": message}
    r = sc.post("/api/bullets", json={"parentId": si["l4"], "afterId": None, "text": ""})
    assert r.status_code == 409 and r.json()["error"] == "too_deep"
    kept = snapshot(sc)
    with tab(browser, short, s.email, "/") as page:
        ready(page)
        focus(page, si["ex"])
        page.keyboard.press("Tab")
        expect(alert(page)).to_contain_text(message, timeout=UI_MS)
    assert snapshot(sc) == kept
    r = sc.post(f"/api/bullets/{si['x']}/move", json={"op": "indent"})
    assert r.status_code == 200, "the depth limit itself is allowed"


def test_wf_indent_edges_delete_dialog(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+Backspace")
        dialog = menu_dialog(page, "Delete bullet")
        expect(dialog).to_be_visible(timeout=UI_MS)
        expect(dialog).to_contain_text(f"Delete {T['pp']} and the {PP_INSIDE} bullets inside it?")
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
        names = tab_order(page, 4)
        assert set(names) <= {"Delete", "Cancel"}, f"Tab left the dialog: {names}"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(row(page, i["pp"])).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Control+Shift+Backspace")
        expect(dialog).to_be_visible(timeout=UI_MS)
        dialog.get_by_role("button", name="Cancel").click()
        expect(dialog).to_have_count(0)
        expect(row(page, i["pp"])).to_have_attribute("aria-selected", "true")
    assert bullet(c, i["pp"])["childCount"] == 3 and bullet(c, i["tom"])["parentId"] == i["pp"]


def test_wf_indent_edges_delete_confirm(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+Backspace")
        dialog = menu_dialog(page, "Delete bullet")
        expect(dialog).to_be_visible(timeout=UI_MS)
        dialog.get_by_role("button", name="Delete", exact=True).click()
        expect(status(page)).to_contain_text("Moved Planting plan to trash", timeout=UI_MS)
        expect(page.get_by_role("treeitem", selected=True)).to_have_count(1, timeout=UI_MS)
        expect(row(page, i["pp"])).to_have_count(0)
    for ref in ("pp", "tom", "herb", "wild"):
        until_status(c, f"/api/bullets/{i[ref]}", 404, f"{ref} is in the trash")


def test_wf_indent_edges_into_collapsed(browser, app_url):
    base = app_url.rstrip("/")
    tree_seed = seed_outline()
    tree_seed[0]["children"][2]["children"].append({"ref": "kid", "text": CHILD_TEXT})
    w = seed_world(base, outline=tree_seed)
    i, c = w.ids, w.owner()
    assert bullet(c, i["tool"])["collapsed"] is True
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        expect(row(page, i["tool"])).to_have_attribute("aria-expanded", "false", timeout=UI_MS)
        expect(row(page, i["wheel"])).not_to_be_visible()
        focus(page, i["kid"])
        page.keyboard.press("Tab")
        expect(status(page)).to_contain_text(f"Indented under {T['tool']}", timeout=UI_MS)
        until_bullet(c, i["kid"], lambda b: b["parentId"] == i["tool"] and b["position"] == 1,
                     "the indented bullet is the last child of the collapsed bullet above")
        until_bullet(c, i["tool"], lambda b: b["collapsed"] is False, "indenting expands the collapsed bullet")
        kid = row(page, i["kid"])
        expect(kid).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(kid).to_have_attribute("aria-level", "4")
        expect(kid).to_have_attribute("data-depth", "3")
        expect(row(page, i["tool"])).to_have_attribute("aria-expanded", "true", timeout=UI_MS)
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "false")
        expect(row(page, i["wheel"])).to_be_visible(timeout=UI_MS)
        page.reload()
        ready(page)
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "false", timeout=UI_MS)
        page.wait_for_function(INSIDE_JS, arg=[i["tool"], i["kid"]], timeout=UI_MS)
        page.wait_for_function(ORDER_JS, arg=[i["wheel"], i["kid"]], timeout=UI_MS)


def test_collapse_and_expand(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["cgb"])
        page.evaluate("(id) => { window.__fold = (" + COLLAPSE_JS + ")(id); }", i["cgb"])
        page.keyboard.press("Control+Space")
        fold = page.evaluate("() => window.__fold")
        assert fold["start"] is not None, "collapsing shrinks the bullet's row"
        assert len(fold["heights"]) >= 2, f"collapse animates through intermediate heights, got {fold['heights']}"
        assert fold["last"] - fold["start"] < COLLAPSE_MAX_MS, f"collapse took {fold['last'] - fold['start']} ms"
        expect(row(page, i["cgb"])).to_have_attribute("aria-expanded", "false", timeout=UI_MS)
        expect(row(page, i["cgb"])).to_have_attribute("data-collapsed", "true")
        expect(row(page, i["sp"])).not_to_be_visible(timeout=UI_MS)
        until_bullet(c, i["cgb"], lambda b: b["collapsed"] is True, "collapse is saved")
        page.reload()
        ready(page)
        expect(row(page, i["cgb"])).to_have_attribute("data-collapsed", "true")
        toggle = page.get_by_role("button", name=f"Toggle children of {T['cgb']}")
        toggle.click()
        expect(toggle).to_have_attribute("aria-expanded", "true", timeout=UI_MS)
        expect(row(page, i["cgb"])).to_have_attribute("data-collapsed", "false")
        expect(row(page, i["sp"])).to_be_visible(timeout=UI_MS)
        until_bullet(c, i["cgb"], lambda b: b["collapsed"] is False, "expand is saved")
        focus(page, i["cgb"])
        page.keyboard.press("Control+Space")
        expect(status(page)).to_contain_text(f"Collapsed {T['cgb']}", timeout=UI_MS)
        page.keyboard.press("Control+Space")
        expect(status(page)).to_contain_text(f"Expanded {T['cgb']}", timeout=UI_MS)


def test_wf_zoom_focus_keyboard(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["cgb"])
        page.keyboard.press("Alt+ArrowRight")
        expect(page).to_have_url(url_is(f"/b/{i['cgb']}"), timeout=UI_MS)
        expect(status(page)).to_contain_text(f"Zoomed into {T['cgb']}")
        ready(page)
        focus(page, i["pp"])
        page.keyboard.press("Alt+ArrowRight")
        expect(page).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
        title = page.get_by_role("textbox", name="Branch title")
        expect(title).to_be_focused(timeout=UI_MS)
        assert title.evaluate(VALUE_JS).strip() == T["pp"]
        expect(tree(page)).to_have_attribute("data-zoom-root", i["pp"])
        crumbs = page.get_by_role("navigation", name="Breadcrumb")
        expect(crumbs.get_by_role("link", name="Home")).to_be_visible()
        expect(crumbs.get_by_role("link", name=T["cgb"])).to_be_visible()
        expect(crumbs.get_by_text(T["pp"], exact=True)).to_have_attribute("aria-current", "page")
        page.keyboard.press("Alt+ArrowLeft")
        expect(page).to_have_url(url_is(f"/b/{i['cgb']}"), timeout=UI_MS)
        expect(status(page)).to_contain_text(f"Zoomed out to {T['cgb']}")
        expect(row(page, i["pp"])).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        page.keyboard.press("Alt+ArrowLeft")
        expect(page).to_have_url(url_is("/"), timeout=UI_MS)
        expect(status(page)).to_contain_text("Zoomed out to Home")
        expect(row(page, i["cgb"])).to_have_attribute("aria-selected", "true", timeout=UI_MS)


def test_wf_zoom_focus_links(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["tom"])
        page.keyboard.type(" now")
        page.keyboard.press("Alt+ArrowRight")
        expect(page).to_have_url(url_is(f"/b/{i['tom']}"), timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["text"] == f"{T['tom']} now", "text saved before zooming")
        page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Home").click()
        expect(page).to_have_url(url_is("/"), timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        page.get_by_role("link", name=f"Zoom into {T['pp']}").click()
        expect(page).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
        page.get_by_role("button", name="Go back").click()
        expect(page).to_have_url(url_is("/"), timeout=UI_MS)
        page.get_by_role("button", name="Go forward").click()
        expect(page).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
        page.go_back()
        expect(page).to_have_url(url_is("/"), timeout=UI_MS)
        expect(status(page)).to_contain_text("Zoomed out to Home")
        page.get_by_role("link", name=f"Zoom into {T['buy']}").first.click()
        title = page.get_by_role("textbox", name="Branch title")
        expect(title).to_be_visible(timeout=UI_MS)
        assert title.evaluate(VALUE_JS).strip() == T["buy"]
        expect(page.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name=T["sp"])).to_be_visible()


def test_zoom_motion_and_reduced_motion(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    kids = [i["tom"], i["herb"], i["wild"]]
    for reduced in (False, True):
        with tab(browser, base, w.email, "/", reduced=reduced) as page:
            ready(page)
            focus(page, i["pp"])
            page.evaluate("(ids) => { window.__settle = (" + SETTLE_JS + ")(ids); }", kids)
            page.keyboard.press("Alt+ArrowRight")
            expect(page).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
            expect(status(page)).to_contain_text(f"Zoomed into {T['pp']}")
            expect(page.get_by_role("textbox", name="Branch title")).to_be_focused(timeout=UI_MS)
            assert page.get_by_role("textbox", name="Branch title").evaluate(VALUE_JS).strip() == T["pp"]
            settles = page.evaluate("() => window.__settle")
            if reduced:
                assert max(settles) < ZOOM_TITLE_MAX_MS, f"reduced motion swaps at once, settle times {settles}"
                continue
            assert min(settles) >= 0, "children fade in during the zoom"
            assert settles == sorted(settles) and len({round(s / SETTLE_BUCKET_MS) for s in settles}) >= 2, \
                f"children must fade in one after another, got {settles}"
            assert max(settles) < ZOOM_MAX_MS, "the zoom settles in under one second"


def test_empty_and_not_found_branches(browser, app_url):
    base = app_url.rstrip("/")
    empty, stranger = seed_world(base, outline=[]), seed_world(base)
    c = empty.owner()
    with tab(browser, base, empty.email, "/") as page:
        expect(page.get_by_text("Your outline is empty. Start with one thought.")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="Add first bullet").click()
        page.keyboard.type("First")
        page.keyboard.press("Escape")
        poll(lambda: "First" in [b["text"] for b in outline(c)], "the first bullet is saved")
    parent = c.post("/api/bullets", json={"parentId": None, "afterId": None, "text": "Parent"}).json()["bullet"]["id"]
    with tab(browser, base, empty.email, f"/b/{parent}") as page:
        expect(page.get_by_text("Nothing inside this bullet yet.")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="Add bullet").click()
        page.keyboard.type("Child")
        page.keyboard.press("Escape")
        poll(lambda: any(b["text"] == "Child" and b["parentId"] == parent for b in outline(c)),
             "the first child is saved under the zoomed bullet")
    sc = stranger.owner()
    assert sc.delete(f"/api/bullets/{stranger.ids['ret']}").status_code == 200
    assert c.get(f"/api/bullets/{stranger.ids['cgb']}").status_code == 404
    targets = [(empty.email, stranger.ids["cgb"]), (empty.email, f"missing-{uuid.uuid4().hex[:8]}"),
               (stranger.email, stranger.ids["ret"])]
    for email, target in targets:
        with tab(browser, base, email, "/") as page:
            response = page.goto(base + f"/b/{target}")
            assert response is not None and response.status == 404
            expect(page.get_by_role("heading", name="We couldn't find that bullet")).to_be_visible(timeout=UI_MS)
            expect(page.get_by_text("It may have been deleted, or it isn't shared with you.")).to_be_visible()
            back = page.get_by_role("link", name="Back to Home")
            assert urlparse(back.get_attribute("href") or "").path == "/"
            back.click()
            expect(page).to_have_url(url_is("/"), timeout=UI_MS)
    with tab(browser, base, None, f"/b/{stranger.ids['cgb']}") as page:
        expect(page).to_have_url(re.compile(r"/signin\?"), timeout=UI_MS)
        assert parse_qs(urlparse(page.url).query)["next"] == [f"/b/{stranger.ids['cgb']}"]


def test_completing_bullets(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["pp"])
        page.keyboard.press("Control+Enter")
        expect(status(page)).to_contain_text(f"Completed {T['pp']}", timeout=UI_MS)
        expect(row(page, i["pp"])).to_have_attribute("data-completed", "true")
        until_bullet(c, i["pp"], lambda b: b["completed"] is True, "completion is saved")
        assert bullet(c, i["tom"])["completed"] is False and bullet(c, i["wild"])["completed"] is True
        line = box(row(page, i["pp"])).evaluate("el => getComputedStyle(el).textDecorationLine")
        plain = box(row(page, i["tom"])).evaluate("el => getComputedStyle(el).textDecorationLine")
        assert line != plain, "completed text is struck through unlike an open bullet"
        expect(row(page, i["pp"])).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Control+Enter")
        expect(status(page)).to_contain_text(f"Marked {T['pp']} not complete", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["completed"] is False, "un-completion is saved")
        focus(page, i["tom"])
        bar = page.get_by_role("toolbar", name="Bullet actions")
        bar.get_by_role("button", name="Complete").click()
        expect(status(page)).to_contain_text(f"Completed {T['tom']}", timeout=UI_MS)
        expect(bar.get_by_role("button", name="Complete")).to_have_attribute("aria-pressed", "true")
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "toolbar completion is saved")


def test_wf_complete_hide_switch(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        switch = page.get_by_role("switch", name="Hide completed")
        expect(switch).to_have_attribute("aria-checked", "false")
        switch.click()
        expect(status(page)).to_contain_text("3 completed bullets hidden", timeout=UI_MS)
        expect(page.get_by_text("3 completed bullets hidden").first).to_be_attached()
        for ref in ("clear", "wild", "ret"):
            expect(row(page, i[ref])).to_have_count(0, timeout=UI_MS)
        poll(lambda: c.get("/api/me").json()["user"]["hideCompleted"] is True, "the setting is saved on the server")
        other = another_tab(page, base, "/")
        ready(other)
        expect(other.get_by_role("switch", name="Hide completed")).to_have_attribute("aria-checked", "true")
        mark_no_reload(other)
        focus(page, i["tom"])
        page.keyboard.press("Control+Enter")
        expect(row(other, i["tom"])).to_have_count(0, timeout=LIVE_MS)
        assert_no_reload(other)
        switch.click()
        expect(status(page)).to_contain_text("Showing completed bullets", timeout=UI_MS)
        expect(row(page, i["clear"])).to_be_visible(timeout=UI_MS)
        page.reload()
        ready(page)
        expect(page.get_by_role("switch", name="Hide completed")).to_have_attribute("aria-checked", "false")
        assert c.patch("/api/me", json={"hideCompleted": "yes"}).status_code == 422


def test_wf_complete_hide_search_ignores(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, hide=True)
    i = w.ids
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        expect(page.get_by_role("switch", name="Hide completed")).to_have_attribute("aria-checked", "true")
        expect(row(page, i["clear"])).to_have_count(0)
        search = searchbox(page)
        search.fill("is:complete")
        expect(status(page)).to_contain_text("3 matching bullets", timeout=UI_MS)
        for ref in ("clear", "wild", "ret"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "match", timeout=UI_MS)
        search.press("Escape")
        expect(search).to_have_value("")
        expect(row(page, i["clear"])).to_have_count(0, timeout=UI_MS)


def test_wf_complete_hide_parent_with_children(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["vol"])
        page.keyboard.press("Control+Enter")
        expect(status(page)).to_contain_text(f"Completed {T['vol']}", timeout=UI_MS)
        expect(row(page, i["vol"])).to_have_attribute("data-completed", "true", timeout=UI_MS)
        expect(row(page, i["crew"])).to_have_attribute("data-completed", "false")
        until_bullet(c, i["vol"], lambda b: b["completed"] is True, "the parent's completion is saved")
        page.get_by_role("switch", name="Hide completed").click()
        expect(status(page)).to_contain_text("4 completed bullets hidden", timeout=UI_MS)
        for ref in ("vol", "crew", "tool", "clear", "wild", "ret"):
            expect(row(page, i[ref])).not_to_be_visible(timeout=UI_MS)
        for ref in ("cgb", "sp", "pp", "tom", "we", "buy"):
            expect(row(page, i[ref])).to_be_visible()
        poll(lambda: c.get("/api/me").json()["user"]["hideCompleted"] is True, "the setting is saved on the server")
        fresh = another_tab(page, base, "/")
        ready(fresh)
        expect(fresh.get_by_role("switch", name="Hide completed")).to_have_attribute("aria-checked", "true")
        expect(row(fresh, i["tom"])).to_be_visible(timeout=UI_MS)
        for ref in ("vol", "crew", "tool"):
            expect(row(fresh, i[ref])).not_to_be_visible()
    for ref in ("crew", "tool", "wheel"):
        assert bullet(c, i[ref])["completed"] is False, f"{ref} keeps its own flag under a completed parent"


def test_wf_complete_hide_uncomplete_live(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c, g = w.ids, w.owner(), w.collab()
    assert g.patch("/api/me", json={"hideCompleted": False}).status_code == 200
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        page.get_by_role("switch", name="Hide completed").click()
        expect(status(page)).to_contain_text("1 completed bullet hidden", timeout=UI_MS)
        expect(row(page, i["wild"])).not_to_be_visible(timeout=UI_MS)
        poll(lambda: c.get("/api/me").json()["user"]["hideCompleted"] is True, "the owner's setting is saved")
        mark_no_reload(page)
        with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
            ready(guest)
            expect(guest.get_by_role("switch", name="Hide completed")).to_have_attribute("aria-checked", "false")
            expect(row(guest, i["wild"])).to_have_attribute("data-completed", "true", timeout=UI_MS)
            focus(guest, i["wild"])
            guest.keyboard.press("Control+Enter")
            expect(status(guest)).to_contain_text(f"Marked {T['wild']} not complete", timeout=UI_MS)
            until_bullet(c, i["wild"], lambda b: b["completed"] is False, "the collaborator's un-completion is saved")
            expect(row(page, i["wild"])).to_have_attribute("data-completed", "false", timeout=LIVE_MS)
            focus(guest, i["tom"])
            guest.keyboard.press("Control+Enter")
            until_bullet(c, i["tom"], lambda b: b["completed"] is True, "the collaborator's completion is saved")
            expect(row(page, i["tom"])).not_to_be_visible(timeout=LIVE_MS)
            expect(row(guest, i["tom"])).to_be_visible()
        assert_no_reload(page)
        page.reload()
        ready(page)
        expect(row(page, i["wild"])).to_be_visible(timeout=UI_MS)
        expect(row(page, i["tom"])).not_to_be_visible()
    assert c.get("/api/me").json()["user"]["hideCompleted"] is True
    assert g.get("/api/me").json()["user"]["hideCompleted"] is False


def test_mirroring_a_bullet(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["tom"])
        page.keyboard.press("Control+Shift+M")
        expect(status(page)).to_contain_text(f"Mirrored {T['tom']}", timeout=UI_MS)
        poll(lambda: any(b["mirrorOf"] == i["tom"] for b in outline(c)), "a copy of Tomatoes exists")
        copy = next(b for b in outline(c) if b["mirrorOf"] == i["tom"])
        assert copy["parentId"] == i["pp"] and copy["position"] == 1 and copy["text"] == T["tom"]
        assert copy["tags"] == ["seedlings"] and copy["completed"] is False
        expect(row(page, copy["id"])).to_have_attribute("data-mirror-of", i["tom"], timeout=UI_MS)
        expect(row(page, copy["id"])).to_have_attribute("aria-selected", "true")
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+M")
        poll(lambda: any(b["mirrorOf"] == i["pp"] for b in outline(c)), "a copy of Planting plan exists")
        pcopy = next(b for b in outline(c) if b["mirrorOf"] == i["pp"])
        assert pcopy["childCount"] == bullet(c, i["pp"])["childCount"]
        assert pcopy["position"] == bullet(c, i["pp"])["position"] + 1
        inside = row(page, pcopy["id"])
        expect(inside.get_by_role("treeitem", name=T["herb"], exact=True)).to_have_count(1, timeout=UI_MS)
        focus(page, i["herb"])
        page.get_by_role("toolbar", name="Bullet actions").get_by_role("button", name="Mirror").click()
        poll(lambda: any(b["mirrorOf"] == i["herb"] for b in outline(c)), "the Mirror button makes a copy")
    again = c.post(f"/api/bullets/{i['bcopy']}/mirror", json={})
    assert again.status_code == 201 and again.json()["bullet"]["mirrorOf"] == i["buy"], \
        "mirroring a copy makes another copy of the same original"


def test_wf_mirror_edit_live(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="cgb")
    i, c = w.ids, w.owner()
    first = "Buy compost bags #soil fresh"
    last = first + " #mulch"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        with tab(browser, base, w.collab_email, f"/b/{i['cgb']}") as guest:
            ready(guest)
            mark_no_reload(other)
            mark_no_reload(guest)
            focus(page, i["buy"])
            page.keyboard.type(" fresh")
            page.keyboard.press("Escape")
            until_bullet(c, i["buy"], lambda b: b["text"] == first, "the text edit reaches the original")
            expect(row(other, i["bcopy"])).to_have_accessible_name(first, timeout=LIVE_MS)
            expect(row(other, i["buy"])).to_have_accessible_name(first, timeout=LIVE_MS)
            expect(row(guest, i["bcopy"])).to_have_accessible_name(first, timeout=LIVE_MS)
            focus(page, i["bcopy"])
            page.keyboard.press("Control+Enter")
            until_bullet(c, i["buy"], lambda b: b["completed"] is True, "completing the copy completes the original")
            expect(row(other, i["buy"])).to_have_attribute("data-completed", "true", timeout=LIVE_MS)
            expect(row(guest, i["bcopy"])).to_have_attribute("data-completed", "true", timeout=LIVE_MS)
            focus(guest, i["bcopy"])
            guest.keyboard.type(" #mulch")
            guest.keyboard.press("Escape")
            until_bullet(c, i["buy"], lambda b: b["text"] == last and "mulch" in b["tags"],
                         "the collaborator's tag edit through the copy reaches the original")
            expect(row(page, i["buy"])).to_have_accessible_name(last, timeout=LIVE_MS)
            expect(row(other, i["bcopy"])).to_have_accessible_name(last, timeout=LIVE_MS)
            assert_no_reload(other)
            assert_no_reload(guest)


def test_wf_mirror_edit_via_copy_api(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        mark_no_reload(page)
        rev = bullet(c, i["bcopy"])["revision"]
        assert rev == bullet(c, i["buy"])["revision"], "a copy carries the original's revision"
        r = c.patch(f"/api/bullets/{i['bcopy']}", json={"text": DELIVERED, "revision": rev})
        assert r.status_code == 200
        assert c.patch(f"/api/bullets/{i['bcopy']}", json={"completed": True}).status_code == 200
        assert bullet(c, i["buy"])["text"] == DELIVERED and bullet(c, i["buy"])["completed"] is True
        for ref in ("buy", "bcopy"):
            expect(row(page, i[ref])).to_have_accessible_name(DELIVERED, timeout=LIVE_MS)
            expect(row(page, i[ref])).to_have_attribute("data-completed", "true", timeout=LIVE_MS)
        assert_no_reload(page)


def test_wf_mirror_edit_branch_title(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    edited = f"{T['buy']} fresh"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        focus(page, i["bcopy"])
        page.keyboard.press("Alt+ArrowRight")
        expect(status(page)).to_contain_text(f"Zoomed into {T['buy']}", timeout=UI_MS)
        crumbs = page.get_by_role("navigation", name="Breadcrumb")
        expect(crumbs.get_by_role("link", name=T["sp"], exact=True)).to_be_visible(timeout=UI_MS)
        expect(crumbs.get_by_role("link", name=T["we"], exact=True)).to_have_count(0)
        title = page.get_by_role("textbox", name="Branch title")
        expect(title).to_be_focused(timeout=UI_MS)
        page.keyboard.press("End")
        page.keyboard.type(" fresh")
        until_bullet(c, i["buy"], lambda b: b["text"] == edited, "the title edit through the copy reaches the original")
        for ref in ("buy", "bcopy"):
            expect(row(other, i[ref])).to_have_accessible_name(edited, timeout=LIVE_MS)
        expect(row(other, i["bcopy"])).to_have_attribute("data-mirror-of", i["buy"])
        assert_no_reload(other)
        page.reload()
        title = page.get_by_role("textbox", name="Branch title")
        expect(title).to_be_visible(timeout=UI_MS)
        poll(lambda: title.evaluate(VALUE_JS) == edited, "a fresh load of the copy shows the original's new text")
    copy = bullet(c, i["bcopy"])
    assert copy["text"] == edited and copy["mirrorOf"] == i["buy"]


def test_no_mirror_inside_itself(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    copy_text = "Can't place a bullet inside itself."
    refusal = {"error": "inside_itself", "message": copy_text}
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["we"])
        page.keyboard.press("Control+Shift+M")
        poll(lambda: any(b["mirrorOf"] == i["we"] for b in outline(c)), "a copy of Weekly errands exists")
        after = snapshot(c)
        page.keyboard.press("Tab")
        expect(alert(page)).to_contain_text(copy_text, timeout=UI_MS)
    assert snapshot(c) == after
    copy_id = next(b["id"] for b in outline(c) if b["mirrorOf"] == i["we"])
    r = c.post(f"/api/bullets/{copy_id}/move", json={"op": "indent"})
    assert r.status_code == 409 and r.json() == refusal
    for path, body in ((f"/api/bullets/{i['cgb']}/move", {"parentId": i["sp"], "index": 0}),
                       (f"/api/bullets/{i['we']}/move", {"parentId": copy_id, "index": 0}),
                       (f"/api/bullets/{i['we']}/move", {"parentId": i["ret"], "index": 0}),
                       (f"/api/bullets/{i['cgb']}/mirror", {"parentId": i["sp"], "index": 0})):
        r = c.post(path, json=body)
        assert r.status_code == 409 and r.json() == refusal, f"{path} {body} answered {r.status_code}"
    r = c.post(f"/api/bullets/{i['cgb']}/mirror", json={"parentId": i["we"], "index": 0})
    assert r.status_code == 201
    through = snapshot(c)
    r = c.post(f"/api/bullets/{i['we']}/move", json={"parentId": i["sp"], "index": 0})
    assert r.status_code == 409 and r.json() == refusal, "placing a bullet inside itself through a copy is refused"
    assert snapshot(c) == through


READONLY_JS = """e => (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') ? (e.readOnly || e.disabled)
  : (!e.isContentEditable || e.getAttribute('aria-readonly') === 'true')"""


def test_deleting_copies_and_originals(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["bcopy"])
        page.keyboard.press("Control+Shift+Backspace")
        expect(status(page)).to_contain_text(f"Removed copy of {T['buy']}", timeout=UI_MS)
        until_status(c, f"/api/bullets/{i['bcopy']}", 404, "the copy is removed")
    assert bullet(c, i["buy"])["text"] == T["buy"]
    r = c.delete(f"/api/bullets/{i['bcopy']}")
    assert r.status_code == 404
    w2 = seed_world(base)
    i2, c2 = w2.ids, w2.owner()
    r = c2.post(f"/api/bullets/{i2['buy']}/mirror", json={})
    assert r.status_code == 201
    with tab(browser, base, w2.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        focus(page, i2["buy"])
        page.keyboard.press("Control+Shift+Backspace")
        expect(status(page)).to_contain_text(f"Moved {T['buy']} to trash", timeout=UI_MS)
        for p in (page, other):
            expect(row(p, i2["bcopy"])).to_have_accessible_name(PLACEHOLDER, timeout=LIVE_MS)
            poll(lambda: box(row(p, i2["bcopy"])).evaluate(READONLY_JS), "the placeholder copy's textbox is read-only")
    until_status(c2, f"/api/bullets/{i2['buy']}", 404, "the original is trashed")
    ghost = bullet(c2, i2["bcopy"])
    assert ghost["placeholder"] is True and ghost["text"] == "" and ghost["childCount"] == 0
    assert ghost["tags"] == [] and ghost["mentions"] == []
    assert i2["buy"] not in [b["id"] for b in outline(c2)]
    assert c2.get("/api/search", params={"q": "#soil"}).json()["count"] == 2


def test_wf_mirror_delete_undo_original(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    before, original = snapshot(c), bullet(c, i["buy"])
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        focus(page, i["buy"])
        page.keyboard.press("Control+Shift+Backspace")
        expect(status(page)).to_contain_text(f"Moved {T['buy']} to trash", timeout=UI_MS)
        expect(row(other, i["bcopy"])).to_have_accessible_name(PLACEHOLDER, timeout=LIVE_MS)
        page.keyboard.press("Control+z")
        expect(status(page)).to_contain_text("Undid delete", timeout=UI_MS)
        expect(row(other, i["bcopy"])).to_have_accessible_name(T["buy"], timeout=LIVE_MS)
        expect(row(page, i["buy"])).to_be_visible(timeout=UI_MS)
    restored = bullet(c, i["buy"])
    for key in ("parentId", "position", "text", "completed", "tags", "mentions", "date"):
        assert restored[key] == original[key], f"{key} differs after undo"
    assert snapshot(c) == before


def test_wf_mirror_delete_undo_branch(browser, app_url):
    base = app_url.rstrip("/")
    tree_seed = seed_outline()
    tree_seed[0]["children"][2]["children"].append({"ref": "pcopy", "mirrorOf": "pp"})
    w = seed_world(base, outline=tree_seed)
    i, c = w.ids, w.owner()
    before = snapshot(c)
    details = {ref: bullet(c, i[ref]) for ref in ("pp", "tom", "herb", "wild")}
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+Backspace")
        dialog = menu_dialog(page, "Delete bullet")
        expect(dialog).to_be_visible(timeout=UI_MS)
        dialog.get_by_role("button", name="Delete", exact=True).click()
        expect(status(page)).to_contain_text(f"Moved {T['pp']} to trash", timeout=UI_MS)
        expect(row(other, i["pcopy"])).to_have_accessible_name(PLACEHOLDER, timeout=LIVE_MS)
        page.get_by_role("button", name="Undo").click()
        expect(status(page)).to_contain_text("Undid delete", timeout=UI_MS)
        expect(row(other, i["pcopy"])).to_have_accessible_name(T["pp"], timeout=LIVE_MS)
    assert snapshot(c) == before
    for ref, old in details.items():
        now = bullet(c, i[ref])
        for key in ("parentId", "position", "text", "completed", "tags", "mentions", "date", "depth"):
            assert now[key] == old[key], f"{ref}.{key} differs after undo"


def test_wf_mirror_delete_undo_copy(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    before = snapshot(c)
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["bcopy"])
        page.keyboard.press("Control+Shift+Backspace")
        expect(status(page)).to_contain_text(f"Removed copy of {T['buy']}", timeout=UI_MS)
        until_status(c, f"/api/bullets/{i['bcopy']}", 404, "the copy is removed")
        page.keyboard.press("Control+z")
        expect(status(page)).to_contain_text("Undid delete", timeout=UI_MS)
    assert snapshot(c) == before and bullet(c, i["bcopy"])["mirrorOf"] == i["buy"]


def test_wf_mirror_delete_copies_inside_branch(browser, app_url):
    base = app_url.rstrip("/")
    tree_seed = seed_outline()
    tree_seed[0]["children"][1]["children"].append({"ref": "ccopy", "mirrorOf": "crew"})
    tree_seed[1]["children"].append({"ref": "tcopy", "mirrorOf": "tom"})
    w = seed_world(base, outline=tree_seed)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        expect(row(other, i["tcopy"])).to_have_accessible_name(T["tom"], timeout=UI_MS)
        expect(row(other, i["ccopy"])).to_have_attribute("data-mirror-of", i["crew"])
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+Backspace")
        dialog = menu_dialog(page, "Delete bullet")
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused(timeout=UI_MS)
        page.keyboard.press("Tab")
        expect(dialog.get_by_role("button", name="Delete", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(status(page)).to_contain_text(f"Moved {T['pp']} to trash", timeout=UI_MS)
        expect(row(other, i["tcopy"])).to_have_accessible_name(PLACEHOLDER, timeout=LIVE_MS)
        expect(row(other, i["ccopy"])).to_have_count(0, timeout=LIVE_MS)
        expect(row(other, i["crew"])).to_have_accessible_name(T["crew"])
        assert_no_reload(other)
        other.reload()
        ready(other)
        expect(row(other, i["tcopy"])).to_have_accessible_name(PLACEHOLDER, timeout=UI_MS)
        expect(row(other, i["ccopy"])).to_have_count(0)
    for ref in ("pp", "tom", "ccopy"):
        until_status(c, f"/api/bullets/{i[ref]}", 404, f"{ref} is in the trash with its branch")
    crew = bullet(c, i["crew"])
    assert crew["text"] == T["crew"] and crew["placeholder"] is False
    ghost = bullet(c, i["tcopy"])
    assert ghost["placeholder"] is True and ghost["text"] == "" and ghost["mirrorOf"] == i["tom"]


@pytest.mark.timeout(180)
def test_purge_after_trash_window(app_url):
    short = outage("APP_SHORT_URL")
    w = seed_world(short)
    i, c = w.ids, w.owner()
    tags = {s["value"]: s["count"] for s in c.get("/api/suggest", params={"kind": "tag", "prefix": ""}).json()["suggestions"]}
    assert tags["#soil"] == 3
    r = c.delete(f"/api/bullets/{i['buy']}")
    assert r.status_code == 200 and r.json()["result"] == "trashed"
    deleted_at = time.monotonic()
    assert c.get(f"/api/bullets/{i['buy']}").status_code == 404
    wait_real(max(0.0, deleted_at + SHORT_TRASH_S + 1 - time.monotonic()), "the trash window has passed")
    assert c.get(f"/api/bullets/{i['buy']}").status_code == 404
    r = c.post("/api/undo", json={})
    assert r.status_code != 200, "a purged bullet can no longer be restored"
    assert c.get(f"/api/bullets/{i['buy']}").status_code == 404
    ghost = bullet(c, i["bcopy"])
    assert ghost["placeholder"] is True and ghost["text"] == ""
    found = c.get("/api/search", params={"q": "#soil"}).json()
    assert found["count"] == 2 and i["buy"] not in found["matches"] and i["bcopy"] not in found["matches"]
    tags = {s["value"]: s["count"] for s in c.get("/api/suggest", params={"kind": "tag", "prefix": ""}).json()["suggestions"]}
    assert tags["#soil"] == 2
    export = c.get("/api/export", params={"format": "text"}).text
    assert "Buy compost bags" not in export and f"{PLACEHOLDER} (mirror)" in export


SEARCH_CASES = {
    "soil": ("#soil", {"sp", "ph", "buy", "bcopy"}, {"cgb", "we"}, 3),
    "mira": ("@mira", {"ph", "crew"}, {"cgb", "sp", "vol"}, 2),
    "complete": ("is:complete", {"clear", "wild", "ret"}, None, 3),
    "dated": ("has:date -is:complete", {"herb", "wheel"}, None, 2),
    "phrase": ('"soil pH"', {"ph"}, None, 1),
    "excluded": ("#seedlings -wildflowers", {"tom"}, None, 1),
    "nothing": ("garlic", set(), None, 0),
    "upper": ("HAS:DATE -IS:COMPLETE", {"herb", "wheel"}, None, 2),
    "at_limit": ("x" * SEARCH_MAX, set(), None, 0),
    "over_limit": ("x" * (SEARCH_MAX + 1), None, None, None),
}


SEARCH_CASE_IDS = ["soil", "mira", "complete", "dated", "phrase", "excluded", "nothing", "upper", "at_limit",
                   "over_limit"]


@pytest.mark.parametrize("case", SEARCH_CASE_IDS, ids=SEARCH_CASE_IDS)
def test_search_operators(app_url, case):
    query, matches, context, count = SEARCH_CASES[case]
    w = seed_world(app_url.rstrip("/"))
    i, c = w.ids, w.owner()
    r = c.get("/api/search", params={"q": query})
    if count is None:
        assert r.status_code == 422 and "q" in r.json()["errors"]
        return
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == query and body["count"] == count
    assert set(body["matches"]) == {i[m] for m in matches}
    if context is not None:
        assert set(body["context"]) == {i[m] for m in context}


def test_wf_search_operators_typing(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        mark_no_reload(page)
        path = urlparse(page.url).path
        search = searchbox(page)
        search.fill("#soil")
        expect(status(page)).to_contain_text("3 matching bullets", timeout=UI_MS)
        for ref in ("sp", "ph", "buy", "bcopy"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "match", timeout=UI_MS)
        for ref in ("cgb", "we"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "context", timeout=UI_MS)
        expect(row(page, i["pp"])).to_have_count(0)
        search.fill("@mira")
        expect(status(page)).to_contain_text("2 matching bullets", timeout=UI_MS)
        for ref in ("ph", "crew"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "match", timeout=UI_MS)
        for ref in ("cgb", "sp", "vol"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "context", timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_count(0)
        search.fill("has:date -is:complete")
        expect(status(page)).to_contain_text("2 matching bullets", timeout=UI_MS)
        expect(row(page, i["wheel"])).to_be_visible(timeout=UI_MS)
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "true")
        search.fill('"soil pH"')
        expect(status(page)).to_contain_text("1 matching bullet", timeout=UI_MS)
        search.fill("garlic")
        expect(status(page)).to_contain_text("No matching bullets", timeout=UI_MS)
        search.press("Escape")
        expect(search).to_have_value("")
        expect(row(page, i["pp"])).to_be_visible(timeout=UI_MS)
        assert row(page, i["cgb"]).get_attribute("data-search") is None
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "true")
        assert urlparse(page.url).path == path
        assert_no_reload(page)


def test_wf_search_operators_clear_and_limit(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        search = searchbox(page)
        search.fill("is:complete")
        expect(status(page)).to_contain_text("3 matching bullets", timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_count(0, timeout=UI_MS)
        search.fill("")
        for ref in ("tom", "herb", "crew", "ret"):
            expect(row(page, i[ref])).to_be_visible(timeout=UI_MS)
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "true")
        assert row(page, i["tom"]).get_attribute("data-search") is None
        search.fill("y" * (SEARCH_MAX + 1))
        expect(page.get_by_text(f"Search holds at most {SEARCH_MAX} characters.")).to_be_visible(timeout=UI_MS)


def test_wf_search_operators_typed_date_in_view(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    tomorrow = date.fromisoformat(TODAY) + timedelta(days=1)
    shown = f"{tomorrow.day} {MONTHS[tomorrow.month - 1]} {tomorrow.year}"
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        mark_no_reload(page)
        focus(page, i["tom"])
        page.keyboard.type(" !(tomorrow)")
        page.keyboard.press("Escape")
        until_bullet(c, i["tom"], lambda b: b["date"] == tomorrow.isoformat()
                     and b["text"] == f"{T['tom']} !({tomorrow.isoformat()})", "the typed date is recognised on save")
        focus(page, i["wild"])
        expect(row(page, i["tom"])).to_contain_text(shown, timeout=UI_MS)
        search = searchbox(page)
        search.click()
        search.press_sequentially("has:date")
        expect(status(page)).to_contain_text("2 matching bullets", timeout=UI_MS)
        for ref in ("tom", "herb"):
            expect(row(page, i[ref])).to_have_attribute("data-search", "match", timeout=UI_MS)
        expect(row(page, i["wild"])).to_have_count(0)
        search.fill("@mira")
        expect(status(page)).to_contain_text("No matching bullets", timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_count(0, timeout=UI_MS)
        search.press("Escape")
        expect(search).to_have_value("")
        expect(row(page, i["wild"])).to_be_visible(timeout=UI_MS)
        assert_no_reload(page)
    found = c.get("/api/search", params={"q": "has:date", "root": i["pp"]}).json()
    assert found["count"] == 2 and set(found["matches"]) == {i["tom"], i["herb"]}
    assert c.get("/api/search", params={"q": "@mira", "root": i["pp"]}).json()["count"] == 0


def _next_on_or_after(today: date, month: int, day: int) -> date:
    candidate = date(today.year, month, day)
    return candidate if candidate >= today else date(today.year + 1, month, day)


def test_dates_in_bullets(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    c, i = w.owner(), w.ids
    today = date.fromisoformat(TODAY)
    tomorrow = today + timedelta(days=1)
    yesterday = today - timedelta(days=1)
    past = _next_on_or_after(today, yesterday.month, yesterday.day)
    cases = [
        (f"Plan !({today.isoformat()})", f"Plan !({today.isoformat()})", today.isoformat()),
        (f"Plan !({today.day} {MONTHS[today.month - 1]} {today.year})", f"Plan !({today.isoformat()})",
         today.isoformat()),
        (f"Plan !({MONTHS[today.month - 1].upper()} {today.day})", f"Plan !({today.isoformat()})",
         today.isoformat()),
        (f"Plan !({MONTHS[yesterday.month - 1]} {yesterday.day})", f"Plan !({past.isoformat()})", past.isoformat()),
        ("Plan !(today)", f"Plan !({today.isoformat()})", today.isoformat()),
        ("Plan !(tomorrow)", f"Plan !({tomorrow.isoformat()})", tomorrow.isoformat()),
        ("Plan !(31 Feb 2026)", "Plan !(31 Feb 2026)", None),
        ("A !(2026-11-07) B !(2026-12-01)", "A !(2026-11-07) B !(2026-12-01)", "2026-11-07"),
    ]
    for typed, stored, expected in cases:
        made = c.post("/api/bullets", json={"parentId": None, "afterId": None, "text": ""}).json()["bullet"]
        r = c.patch(f"/api/bullets/{made['id']}", json={"text": typed, "revision": made["revision"]})
        assert r.status_code == 200, typed
        saved = r.json()["bullet"]
        assert saved["text"] == stored and saved["date"] == expected, f"{typed!r} saved as {saved['text']!r}"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        expect(row(page, w.ids["clear"])).to_contain_text("7 Nov 2026", timeout=UI_MS)
        assert bullet(c, i["clear"])["date"] == "2026-11-07"


def test_tag_and_mention_suggestions(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()

    def listed(kind, prefix=""):
        r = c.get("/api/suggest", params={"kind": kind, "prefix": prefix})
        assert r.status_code == 200
        return [(s["value"], s["count"]) for s in r.json()["suggestions"]]

    assert listed("tag") == [("#soil", 3), ("#seedlings", 2)]
    assert listed("mention") == [("@mira", 2), ("@jonah", 1)]
    assert listed("tag", "se") == [("#seedlings", 2)] and listed("tag", "SO") == [("#soil", 3)]
    assert c.get("/api/suggest", params={"kind": "color", "prefix": ""}).status_code == 422
    made = c.post("/api/bullets", json={"parentId": None, "afterId": None, "text": ""}).json()["bullet"]
    r = c.patch(f"/api/bullets/{made['id']}", json={"text": DIG_TEXT, "revision": made["revision"]})
    saved = r.json()["bullet"]
    assert saved["text"] == DIG_TEXT and saved["tags"] == ["soil"] and saved["mentions"] == ["mira"]
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["ret"])
        page.keyboard.type(" #")
        listbox = page.get_by_role("listbox", name="Suggestions")
        expect(listbox).to_be_visible(timeout=UI_MS)
        options = listbox.get_by_role("option")
        expect(options.nth(0)).to_have_accessible_name("#soil")
        expect(options.nth(1)).to_have_accessible_name("#seedlings")
        before = len(outline(c))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        value = box(row(page, i["ret"])).evaluate(VALUE_JS)
        assert value == f"{T['ret']} #seedlings ", f"Enter inserts the highlighted value, got {value!r}"
        assert len(outline(c)) == before, "Enter with the list open adds no bullet"
        page.keyboard.press("Escape")
        until_bullet(c, i["ret"], lambda b: "seedlings" in b["tags"], "the inserted tag is saved")
        focus(page, i["tom"])
        page.keyboard.type(" @")
        mentions = page.get_by_role("listbox", name="Suggestions").get_by_role("option")
        expect(mentions.nth(0)).to_have_accessible_name("@mira", timeout=UI_MS)
        expect(mentions.nth(1)).to_have_accessible_name("@jonah")
        page.keyboard.press("Escape")
        expect(page.get_by_role("listbox", name="Suggestions")).to_have_count(0)
        assert box(row(page, i["tom"])).evaluate(VALUE_JS).endswith("@")


def test_board_layout(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    columns = {"sp": ("3", [T["clear"], T["ph"], T["buy"]]), "pp": ("3", [T["tom"], T["herb"], T["wild"]]),
               "vol": ("2", [T["crew"], T["tool"]])}
    with tab(browser, base, w.email, f"/b/{i['cgb']}") as page:
        ready(page)
        page.get_by_role("button", name="Show as board").click()
        expect(page).to_have_url(re.compile(r"[?&]view=board"), timeout=UI_MS)
        expect(page.get_by_role("button", name="Show as board")).to_have_count(0)
        for ref, (count, cards) in columns.items():
            column = page.get_by_role("region", name=T[ref])
            expect(column).to_be_visible(timeout=UI_MS)
            expect(column.get_by_role("heading", name=T[ref])).to_be_visible()
            expect(column).to_contain_text(count)
            items = column.get_by_role("listitem")
            expect(items).to_have_count(len(cards))
            for k, text in enumerate(cards):
                expect(items.nth(k)).to_have_accessible_name(text)
        expect(page.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True)
               ).to_have_attribute("data-bullet-id", i["tom"])
        page.get_by_role("button", name="Show as list").click()
        ready(page)
        assert "view=board" not in page.url
        page.wait_for_function(INSIDE_JS, arg=[i["pp"], i["tom"]], timeout=UI_MS)
        page.wait_for_function(ORDER_JS, arg=[i["sp"], i["pp"]], timeout=UI_MS)
        page.goto(base + f"/b/{i['cgb']}?view=board")
        expect(page.get_by_role("region", name=T["vol"])).to_be_visible(timeout=UI_MS)


def test_wf_board_view_keyboard_move(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, f"/b/{i['cgb']}?view=board") as page:
        expect(page.get_by_role("region", name=T["pp"])).to_be_visible(timeout=UI_MS)
        other = another_tab(page, base, f"/b/{i['cgb']}?view=board")
        expect(other.get_by_role("region", name=T["sp"])).to_be_visible(timeout=UI_MS)
        card = page.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True)
        card.focus()
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(
            f"Picked up {T['tom']}. Use the arrow keys to move it, Space to drop, Escape to cancel.", timeout=UI_MS)
        page.keyboard.press("ArrowLeft")
        expect(status(page)).to_contain_text(f"{T['tom']}: position 1 of 4 in {T['sp']}", timeout=UI_MS)
        page.keyboard.press("ArrowDown")
        expect(status(page)).to_contain_text(f"{T['tom']}: position 2 of 4 in {T['sp']}", timeout=UI_MS)
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text("Dropped Tomatoes #seedlings in Site prep #soil, position 2 of 4", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"] and b["position"] == 1,
                     "the dropped card is saved under Site prep at position 2")
        expect(other.get_by_role("region", name=T["sp"]).get_by_role("listitem", name=T["tom"], exact=True)) \
            .to_be_visible(timeout=LIVE_MS)
        page.get_by_role("button", name="Show as list").click()
        ready(page)
        page.wait_for_function(INSIDE_JS, arg=[i["sp"], i["tom"]], timeout=UI_MS)


def test_wf_board_view_escape_cancel(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    before = snapshot(c)
    with tab(browser, base, w.email, f"/b/{i['cgb']}?view=board") as page:
        expect(page.get_by_role("region", name=T["pp"])).to_be_visible(timeout=UI_MS)
        page.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["herb"], exact=True).focus()
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(f"Picked up {T['herb']}.", timeout=UI_MS)
        page.keyboard.press("ArrowRight")
        expect(status(page)).to_contain_text(f"{T['herb']}: position 2 of 3 in Volunteers")
        page.keyboard.press("Escape")
        expect(status(page)).to_contain_text(f"Move cancelled. {T['herb']} is back in Planting plan.")
        expect(page.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["herb"], exact=True)).to_be_visible()
    assert snapshot(c) == before


def test_wf_board_view_pointer_drag(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, f"/b/{i['cgb']}?view=board") as page:
        target_col = page.get_by_role("region", name=T["pp"])
        expect(target_col).to_be_visible(timeout=UI_MS)
        card = page.get_by_role("region", name=T["vol"]).get_by_role("listitem", name=T["crew"], exact=True)
        last = target_col.get_by_role("listitem", name=T["wild"], exact=True)
        cb, lb = card.bounding_box(), last.bounding_box()
        page.mouse.move(cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2)
        page.mouse.down()
        page.mouse.move(lb["x"] + lb["width"] / 2, lb["y"] + lb["height"] - 2, steps=SWIPE_STEPS * 2)
        page.mouse.up()
        expect(status(page)).to_contain_text(re.compile(
            r"Dropped Saturday crew @Mira in Planting plan, position \d of 4"), timeout=UI_MS)
        until_bullet(c, i["crew"], lambda b: b["parentId"] == i["pp"], "the dragged card is saved under Planting plan")


def test_wf_board_view_reduced_motion_reorder(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    path = f"/b/{i['cgb']}?view=board"
    with tab(browser, base, w.email, path, reduced=True) as page:
        column = page.get_by_role("region", name=T["pp"])
        expect(column).to_be_visible(timeout=UI_MS)
        other = another_tab(page, base, path)
        expect(other.get_by_role("region", name=T["pp"])).to_be_visible(timeout=UI_MS)
        mark_no_reload(other)
        column.get_by_role("listitem", name=T["wild"], exact=True).focus()
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(
            f"Picked up {T['wild']}. Use the arrow keys to move it, Space to drop, Escape to cancel.", timeout=UI_MS)
        page.keyboard.press("ArrowUp")
        expect(status(page)).to_contain_text(f"{T['wild']}: position 2 of 3 in {T['pp']}", timeout=UI_MS)
        page.keyboard.press("ArrowUp")
        expect(status(page)).to_contain_text(f"{T['wild']}: position 1 of 3 in {T['pp']}", timeout=UI_MS)
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(f"Dropped {T['wild']} in {T['pp']}, position 1 of 3", timeout=UI_MS)
        until_bullet(c, i["wild"], lambda b: b["parentId"] == i["pp"] and b["position"] == 0,
                     "the dropped card is saved first in Planting plan")
        assert [b["id"] for b in outline(c, i["pp"]) if b["parentId"] == i["pp"]] == [i["wild"], i["tom"], i["herb"]]
        expect(other.get_by_role("region", name=T["pp"]).get_by_role("listitem").first) \
            .to_have_accessible_name(T["wild"], timeout=LIVE_MS)
        assert_no_reload(other)
        page.reload()
        cards = page.get_by_role("region", name=T["pp"]).get_by_role("listitem")
        expect(cards).to_have_count(3, timeout=UI_MS)
        for k, ref in enumerate(("wild", "tom", "herb")):
            expect(cards.nth(k)).to_have_accessible_name(T[ref])


def _token(message: dict) -> str:
    found = re.search(r"/invite/([^\s\"'<>)]+)", _helper("text")(message))
    assert found, "the invitation body must carry the /invite/<token> link"
    return found.group(1)


def test_branch_invitations(browser, app_url, mail):
    base = app_url.rstrip("/")
    w = seed_world(base, collab=True)
    i, c = w.ids, w.owner()
    unknown, _ = person("nobody")
    r1 = c.post(f"/api/bullets/{i['pp']}/shares", json={"email": w.collab_email})
    r2 = c.post(f"/api/bullets/{i['pp']}/shares", json={"email": unknown})
    assert r1.status_code == r2.status_code == 201
    s1, s2 = r1.json()["share"], r2.json()["share"]
    assert set(s1) == set(s2) and s1["status"] == s2["status"] == "sent"
    m1, m2 = mails_to(mail, w.collab_email)[0], mails_to(mail, unknown)[0]
    subject = f"{w.name} shared a branch with you: Planting plan"
    assert m1.get("Subject") == m2.get("Subject") == subject
    for m in (m1, m2):
        body = _helper("text")(m)
        assert w.name in body and "Planting plan" in body
        _token(m)
    r = c.post(f"/api/bullets/{i['pp']}/shares", json={"email": unknown})
    assert r.status_code == 409 and r.json() == {
        "error": "already_invited", "message": "This address already has an open invitation to this bullet."}
    r = c.post(f"/api/bullets/{i['pp']}/shares", json={"email": w.email})
    assert r.status_code == 422 and r.json()["errors"]["email"] == "You can't invite yourself."
    r = c.post(f"/api/bullets/{i['pp']}/shares", json={"email": "not-an-address"})
    assert r.status_code == 422 and r.json()["errors"]["email"] == "Enter a valid email address."
    r = c.post(f"/api/shares/{s1['id']}/retry", json={})
    assert r.status_code == 409 and r.json() == {"error": "not_retryable", "message": "That invitation can't be retried."}
    assert mail_count(mail, unknown) == 1, "refusals send no mail"

    down = outage("APP_MAILPIT_DOWN_URL")
    dc = login(down, w.email)
    offline, _ = person("offline")
    r = dc.post(f"/api/bullets/{i['pp']}/shares", json={"email": offline})
    assert r.status_code == 201 and r.json()["share"]["status"] == "not_sent"
    sid = r.json()["share"]["id"]
    listed = {s["id"]: s["status"] for s in dc.get(f"/api/bullets/{i['pp']}/shares").json()["shares"]}
    assert listed[sid] == "not_sent"
    retry = dc.post(f"/api/shares/{sid}/retry", json={})
    assert retry.status_code == 200 and retry.json()["share"]["status"] == "not_sent"
    ui_offline, _ = person("offui")
    with tab(browser, down, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share bullet")
        field = dialog.get_by_role("textbox", name="Collaborator email")
        expect(field).to_be_focused()
        field.fill(ui_offline)
        page.keyboard.press("Enter")
        line = dialog.get_by_role("list", name="Invitations").get_by_role("listitem").filter(has_text=ui_offline)
        expect(line).to_contain_text("Not sent", timeout=UI_MS)
        expect(dialog.get_by_role("button", name=f"Retry invitation to {ui_offline}")).to_be_visible()
        expect(alert(page)).to_contain_text(
            f"Invitation not sent to {ui_offline}. Mail can't be delivered right now; use Retry.")
        allowed = {"Collaborator email", "Send invitation", "Close"}
        for row_ in dialog.get_by_role("list", name="Invitations").get_by_role("listitem").all():
            txt = row_.inner_text()
            for e in (w.collab_email, unknown, offline, ui_offline):
                if e in txt:
                    allowed |= {f"Retry invitation to {e}", f"Remove access for {e}"}
        names = tab_order(page, 8)
        assert set(names) <= allowed, f"Tab left the Share bullet dialog: {names}"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(page.get_by_role("button", name="Share")).to_be_focused()
    assert mail_count(mail, offline) == 0 and mail_count(mail, ui_offline) == 0

    pending, _ = person("pending")
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share bullet")
        dialog.get_by_role("textbox", name="Collaborator email").fill(pending)
        with _cm(held(page, "**/api/bullets/*/shares")) as hold:
            page.keyboard.press("Enter")
            sending = dialog.get_by_role("button", name="Sending")
            expect(sending).to_be_disabled()
            expect(sending).to_have_attribute("aria-busy", "true")
            line = dialog.get_by_role("list", name="Invitations").get_by_role("listitem").filter(has_text=pending)
            expect(line).to_contain_text("Sending")
            expect(line).not_to_contain_text("Sent")
            hold.release()
        expect(line).to_contain_text("Sent", timeout=UI_MS)
        expect(status(page)).to_contain_text(f"Invitation sent to {pending}")
    assert len(mails_to(mail, pending)) == 1


def test_wf_share_branch_accept_and_edit(browser, app_url, mail):
    base = app_url.rstrip("/")
    w = seed_world(base, collab=True)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share bullet")
        dialog.get_by_role("textbox", name="Collaborator email").fill(w.collab_email)
        page.keyboard.press("Enter")
        line = dialog.get_by_role("list", name="Invitations").get_by_role("listitem").filter(has_text=w.collab_email)
        expect(line).to_contain_text("Sent", timeout=UI_MS)
    token = _token(mails_to(mail, w.collab_email)[0])
    with tab(browser, base, None, f"/invite/{token}") as guest:
        expect(guest.get_by_text(f"Sign in or create an account with {w.collab_email} to open this branch.")) \
            .to_be_visible(timeout=UI_MS)
        expect(guest.get_by_role("link", name="Create an account")).to_be_visible()
        guest.get_by_role("link", name="Sign in").click()
        guest.get_by_role("textbox", name="Email").fill(w.collab_email)
        guest.get_by_label("Password").fill(PASSWORD)
        guest.get_by_role("button", name="Sign in").click()
        expect(guest).to_have_url(url_is(f"/invite/{token}"), timeout=UI_MS)
        guest.get_by_role("button", name="Accept invitation").click()
        expect(guest).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
        expect(status(guest)).to_contain_text("You can now edit Planting plan.")
        ready(guest)
        expect(tree(guest)).to_have_attribute("data-zoom-root", i["pp"])
        home = guest.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Home")
        assert urlparse(home.get_attribute("href") or "").path == f"/b/{i['pp']}"
        expect(guest.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name=T["cgb"])).to_have_count(0)
        assert guest.get_by_role("textbox", name="Branch title").evaluate(VALUE_JS).strip() == T["pp"]
        expect(row(guest, i["tom"])).to_have_attribute("data-depth", "1")
        focus(guest, i["tom"])
        guest.keyboard.press("Control+Enter")
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "the collaborator's completion reaches the owner")
        guest.keyboard.press("End")
        guest.keyboard.press("Enter")
        guest.keyboard.type("Basil")
        guest.keyboard.press("Escape")
        poll(lambda: any(b["text"] == "Basil" and b["parentId"] == i["pp"] and b["position"] == 1
                         for b in c.get("/api/outline").json()["bullets"]), "the collaborator's new bullet is saved")
    assert any(s["status"] == "accepted" for s in c.get(f"/api/bullets/{i['pp']}/shares").json()["shares"])


def test_wf_share_branch_wrong_account(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp", share_status="sent")
    token = w.shares["s1"]["token"]
    stranger = seed_world(base, outline=[])
    with tab(browser, base, stranger.email, f"/invite/{token}") as page:
        expect(page.get_by_text("This invitation was sent to a different email address.")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("button", name="Accept invitation")).to_have_count(0)
    sc = stranger.owner()
    r = sc.post(f"/api/invitations/{token}/accept", json={})
    assert r.status_code == 409 and r.json() == {
        "error": "wrong_account", "message": "This invitation was sent to a different email address."}
    assert sc.get(f"/api/bullets/{w.ids['pp']}").status_code == 404
    assert sc.get("/api/me").json()["shared"] == []


@pytest.mark.timeout(180)
def test_wf_share_branch_lapsed(browser):
    base = outage("APP_SHORT_URL")
    w = seed_world(base, share="pp", share_status="sent")
    token = w.shares["s1"]["token"]
    guest = w.collab()
    assert guest.get(f"/api/invitations/{token}").status_code == 200
    wait_real(SHORT_INVITE_TTL_S + 1, "the invitation lifetime has passed")
    r = guest.post(f"/api/invitations/{token}/accept", json={})
    copy = "This invitation has expired. Ask the owner to send a new one."
    assert r.status_code == 409 and r.json() == {"error": "invitation_lapsed", "message": copy}
    with tab(browser, base, w.collab_email, f"/invite/{token}") as page:
        expect(page.get_by_text(copy)).to_be_visible(timeout=UI_MS)
    assert guest.get(f"/api/bullets/{w.ids['pp']}").status_code == 404


def test_nothing_outside_shared_branch(browser, app_url):
    base = app_url.rstrip("/")
    outline_seed = seed_outline()
    outline_seed[0]["children"][1]["children"].append({"ref": "ppcopy", "mirrorOf": "buy"})
    w = seed_world(base, outline=outline_seed, share="pp")
    i, g = w.ids, w.collab()
    nf = {"error": "not_found"}
    for r in (g.get(f"/api/bullets/{i['cgb']}"), g.get(f"/api/bullets/{i['buy']}"),
              g.patch(f"/api/bullets/{i['sp']}", json={"completed": True}),
              g.delete(f"/api/bullets/{i['we']}"),
              g.post(f"/api/bullets/{i['tom']}/move", json={"parentId": i["sp"], "index": 0}),
              g.post(f"/api/bullets/{i['tom']}/mirror", json={"parentId": i["we"], "index": 0}),
              g.get("/api/outline", params={"root": i["cgb"]}),
              g.get("/api/search", params={"q": "soil", "root": i["cgb"]}),
              g.get(f"/api/bullets/missing-{uuid.uuid4().hex[:8]}")):
        assert r.status_code == 404 and r.json() == nf, f"{r.request.method} {r.request.url} answered {r.status_code}"
    assert bullet(w.owner(), i["sp"])["completed"] is False
    assert bullet(g, i["ppcopy"])["mirrorOf"] == i["buy"]
    view = g.get("/api/outline", params={"root": i["pp"]}).json()
    assert view["root"]["id"] == i["pp"] and view["root"]["parentId"] is None and view["ancestors"] == []
    assert {b["id"] for b in view["bullets"]} <= {i["tom"], i["herb"], i["wild"], i["ppcopy"]}
    s = g.get("/api/search", params={"q": "#soil", "root": i["pp"]}).json()
    assert s["count"] == 1 and s["matches"] == [i["ppcopy"]]
    assert g.get("/api/search", params={"q": "#soil"}).json()["count"] == 0
    tags = g.get("/api/suggest", params={"kind": "tag", "prefix": "", "root": i["pp"]}).json()["suggestions"]
    assert {t["value"]: t["count"] for t in tags} == {"#seedlings": 2, "#soil": 1}
    export = g.get("/api/export", params={"format": "text", "root": i["pp"]}).text
    assert "Tomatoes #seedlings" in export and "Site prep" not in export and "Weekly errands" not in export
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as page:
        for bid in (i["cgb"], i["buy"]):
            response = page.goto(base + f"/b/{bid}")
            assert response is not None and response.status == 404
            expect(page.get_by_role("heading", name="We couldn't find that bullet")).to_be_visible(timeout=UI_MS)


def test_removing_access(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c, g = w.ids, w.owner(), w.collab()
    sid = w.shares["s1"]["id"]
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
        ready(guest)
        with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
            ready(page)
            page.get_by_role("button", name="Share").click()
            dialog = page.get_by_role("dialog", name="Share bullet")
            line = dialog.get_by_role("list", name="Invitations").get_by_role("listitem").filter(has_text=w.collab_email)
            expect(line).to_contain_text("Accepted", timeout=UI_MS)
            dialog.get_by_role("button", name=f"Remove access for {w.collab_email}").click()
            expect(status(page)).to_contain_text(f"Removed access for {w.collab_email}", timeout=UI_MS)
        notice = guest.get_by_role("region", name="Live sync")
        expect(notice).to_contain_text("This branch is no longer shared with you.", timeout=UI_MS)
        back = notice.get_by_role("link", name="Back to Home")
        assert urlparse(back.get_attribute("href") or "").path == "/"
    assert g.get(f"/api/bullets/{i['tom']}").status_code == 404
    assert g.get("/api/outline", params={"root": i["pp"]}).status_code == 404
    r = c.delete(f"/api/shares/{sid}")
    assert r.status_code == 409 and r.json() == {"error": "share_closed", "message": "That share is already closed."}
    assert sid not in [s["id"] for s in c.get(f"/api/bullets/{i['pp']}/shares").json()["shares"]]


def test_wf_co_edit_owner_edits_seen(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
        ready(guest)
        mark_no_reload(guest)
        with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
            ready(page)
            focus(page, i["tom"])
            page.keyboard.type(" now")
            page.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == f"{T['tom']} now", "owner text saved")
            expect(row(guest, i["tom"])).to_have_accessible_name(f"{T['tom']} now", timeout=LIVE_MS)
            focus(page, i["tom"])
            page.keyboard.press("Control+ArrowDown")
            until_bullet(c, i["tom"], lambda b: b["position"] == 1, "owner move saved")
            guest.wait_for_function(ORDER_JS, arg=[i["herb"], i["tom"]], timeout=LIVE_MS)
        assert_no_reload(guest)


def test_wf_co_edit_collab_edits_seen(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        mark_no_reload(page)
        with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
            ready(guest)
            focus(guest, i["herb"])
            guest.keyboard.press("Control+Enter")
            until_bullet(c, i["herb"], lambda b: b["completed"] is True, "collaborator completion saved")
            expect(row(page, i["herb"])).to_have_attribute("data-completed", "true", timeout=LIVE_MS)
            focus(guest, i["herb"])
            guest.keyboard.press("Control+ArrowUp")
            until_bullet(c, i["herb"], lambda b: b["position"] == 0, "collaborator move saved")
            page.wait_for_function(ORDER_JS, arg=[i["herb"], i["tom"]], timeout=LIVE_MS)
        assert_no_reload(page)


def test_wf_co_edit_collab_text_and_indent(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    ready_text = f"{T['tom']} ready"
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        mark_no_reload(page)
        with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
            ready(guest)
            mark_no_reload(guest)
            focus(guest, i["tom"])
            guest.keyboard.type(" ready")
            guest.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == ready_text, "the collaborator's text is saved")
            expect(row(page, i["tom"])).to_have_accessible_name(ready_text, timeout=LIVE_MS)
            focus(guest, i["herb"])
            guest.keyboard.press("Tab")
            expect(status(guest)).to_contain_text(f"Indented under {ready_text}", timeout=UI_MS)
            until_bullet(c, i["herb"], lambda b: b["parentId"] == i["tom"] and b["position"] == 0,
                         "the collaborator's indent is saved")
            page.wait_for_function(INSIDE_JS, arg=[i["tom"], i["herb"]], timeout=LIVE_MS)
            expect(row(page, i["herb"])).to_have_attribute("aria-level", "2")
            focus(page, i["wild"])
            page.keyboard.press("Control+Enter")
            until_bullet(c, i["wild"], lambda b: b["completed"] is False, "the owner's un-completion is saved")
            expect(row(guest, i["wild"])).to_have_attribute("data-completed", "false", timeout=LIVE_MS)
            assert_no_reload(guest)
        assert_no_reload(page)
        page.reload()
        ready(page)
        page.wait_for_function(INSIDE_JS, arg=[i["tom"], i["herb"]], timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_accessible_name(ready_text)


def test_stale_saves_refused(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    rev = bullet(c, i["herb"])["revision"]
    texts = [f"Herb take {k}" for k in range(5)]
    results = fire([lambda t=t: clone(c).patch(f"/api/bullets/{i['herb']}", json={"text": t, "revision": rev})
                    for t in texts])
    wins = [r for r in results if r.status_code == 200]
    losses = [r for r in results if r.status_code == 409]
    assert len(wins) == 1 and len(losses) == 4, [r.status_code for r in results]
    winner = wins[0].json()["bullet"]
    for r in losses:
        body = r.json()
        assert body["error"] == "stale_revision"
        assert body["current"] == {"text": winner["text"], "revision": winner["revision"]}
        assert body["editor"]["name"] == w.name
        assert body["message"] == f"{w.name} changed this bullet first. Their text is shown; your edit was not saved."
    with clocked(browser, base, w.email, f"/b/{i['pp']}") as page:
        eventually(page, lambda: expect(row(page, i["tom"])).to_be_visible(timeout=CHECK_MS), "branch loads")
        click(box(row(page, i["tom"])))
        page.keyboard.press("End")
        page.keyboard.type(" mine")
        g = w.collab()
        rv = bullet(g, i["tom"])["revision"]
        assert g.patch(f"/api/bullets/{i['tom']}", json={"text": COLLAB_TOMATOES, "revision": rv}) \
            .status_code == 200
        advance(page, SAVE_DEBOUNCE_MS)
        eventually(page, lambda: expect(alert(page)).to_contain_text(
            f"{w.collab_name} changed this bullet first. Their text is shown; your edit was not saved.",
            timeout=CHECK_MS), "the losing tab shows the conflict notice")
        eventually(page, lambda: expect(box(row(page, i["tom"]))).to_have_text(COLLAB_TOMATOES,
                                                                               timeout=CHECK_MS)
                   if box(row(page, i["tom"])).evaluate("el => typeof el.value !== 'string'")
                   else expect(box(row(page, i["tom"]))).to_have_value(COLLAB_TOMATOES, timeout=CHECK_MS),
                   "the losing tab shows the winning text")
    assert bullet(c, i["tom"])["text"] == COLLAB_TOMATOES


def test_simultaneous_moves(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pa", outline=[{"ref": "pa", "text": "Pair", "children": [
        {"ref": "x", "text": "Cherry"}, {"ref": "a", "text": "Apple"},
        {"ref": "b", "text": "Banana"}]}])
    i, c, g = w.ids, w.owner(), w.collab()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        results = fire([lambda: c.post(f"/api/bullets/{i['a']}/move", json={"parentId": i["b"], "index": 0}),
                        lambda: g.post(f"/api/bullets/{i['b']}/move", json={"parentId": i["a"], "index": 0})])
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409], codes
        loser = next(r for r in results if r.status_code == 409)
        assert loser.json() == {"error": "inside_itself", "message": "Can't place a bullet inside itself."}
        a, b = bullet(c, i["a"]), bullet(c, i["b"])
        assert (a["parentId"] == i["b"]) != (b["parentId"] == i["a"]), "exactly one bullet ends inside the other"
        parent, child = (i["b"], i["a"]) if a["parentId"] == i["b"] else (i["a"], i["b"])
        page.wait_for_function(INSIDE_JS, arg=[parent, child], timeout=LIVE_MS)
        assert not page.evaluate(INSIDE_JS, [child, parent])


def test_wf_undo_history_buttons_across_tabs(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        focus(page, i["tom"])
        page.keyboard.press("Control+Enter")
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "completion saved")
        other.get_by_role("switch", name="Hide completed").focus()
        other.keyboard.press("Control+z")
        expect(status(other)).to_contain_text("Undid completion", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["completed"] is False, "undo applied on the server")
        expect(row(page, i["tom"])).to_have_attribute("data-completed", "false", timeout=LIVE_MS)
        other.get_by_role("button", name="Redo").click()
        expect(status(other)).to_contain_text("Redid completion", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "redo applied on the server")
        expect(row(page, i["tom"])).to_have_attribute("data-completed", "true", timeout=LIVE_MS)
        page.get_by_role("button", name="Undo").click()
        expect(status(page)).to_contain_text("Undid completion", timeout=UI_MS)
        page.get_by_role("button", name="Download").focus()
        page.keyboard.press("Control+Shift+Z")
        expect(status(page)).to_contain_text("Redid completion", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "Ctrl+Shift+Z redo applied")


def test_wf_undo_history_text_edit_merge(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["tom"])
        page.keyboard.type(" a")
        until_bullet(c, i["tom"], lambda b: b["text"] == "Tomatoes #seedlings a", "first save")
        page.keyboard.type("b")
        until_bullet(c, i["tom"], lambda b: b["text"] == "Tomatoes #seedlings ab", "second save")
        page.keyboard.press("Control+z")
        expect(status(page)).to_contain_text("Undid text edit", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["text"] == T["tom"], "one undo restores the text before both saves")
        expect(row(page, i["tom"])).to_have_accessible_name(T["tom"], timeout=UI_MS)
        page.keyboard.press("Control+z")
        expect(alert(page)).to_contain_text("Nothing more to undo.", timeout=UI_MS)


def test_wf_undo_history_structure_keys(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    s0 = snapshot(c)
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        focus(page, i["tom"])
        page.keyboard.press("Control+ArrowUp")
        expect(status(page)).to_contain_text(f"Moved to position 4 of 4 under {T['sp']}", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"], "the move across parents is saved")
        focus(page, i["wild"])
        page.keyboard.press("Tab")
        expect(status(page)).to_contain_text(f"Indented under {T['herb']}", timeout=UI_MS)
        until_bullet(c, i["wild"], lambda b: b["parentId"] == i["herb"], "the indent is saved")
        other.wait_for_function(INSIDE_JS, arg=[i["herb"], i["wild"]], timeout=LIVE_MS)
        page.keyboard.press("Control+z")
        expect(status(page)).to_contain_text("Undid indent", timeout=UI_MS)
        until_bullet(c, i["wild"], lambda b: b["parentId"] == i["pp"] and b["position"] == 1,
                     "undo returns the indented bullet to its exact old place")
        page.keyboard.press("Control+z")
        expect(status(page)).to_contain_text("Undid move", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["pp"] and b["position"] == 0,
                     "undo returns the moved bullet to its exact old place")
        assert snapshot(c) == s0, "two undos restore the exact tree with the same ids"
        other.wait_for_function(INSIDE_JS, arg=[i["pp"], i["tom"]], timeout=LIVE_MS)
        other.wait_for_function(ORDER_JS, arg=[i["tom"], i["herb"]], timeout=LIVE_MS)
        assert not other.evaluate(INSIDE_JS, [i["herb"], i["wild"]]), "the second tab still shows the undone indent"
        page.keyboard.press("Control+Shift+Z")
        expect(status(page)).to_contain_text("Redid move", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"] and b["position"] == 3, "redo reapplies the move")
        other.wait_for_function(INSIDE_JS, arg=[i["sp"], i["tom"]], timeout=LIVE_MS)
        assert_no_reload(other)


def test_wf_undo_history_blocked_by_collaborator(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    mine = f"{T['tom']} mine"
    theirs = f"{mine} theirs"
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
            ready(guest)
            focus(page, i["tom"])
            page.keyboard.type(" mine")
            page.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == mine, "the owner's text is saved")
            expect(row(guest, i["tom"])).to_have_accessible_name(mine, timeout=LIVE_MS)
            focus(guest, i["tom"])
            guest.keyboard.type(" theirs")
            guest.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == theirs, "the collaborator's text is saved")
            expect(row(page, i["tom"])).to_have_accessible_name(theirs, timeout=LIVE_MS)
            page.keyboard.press("Control+z")
            expect(alert(page)).to_contain_text(f"Can't undo: {w.collab_name} has edited this bullet since.",
                                                timeout=UI_MS)
            page.keyboard.press("Control+z")
            expect(alert(page)).to_contain_text("Nothing more to undo.", timeout=UI_MS)
            expect(row(guest, i["tom"])).to_have_accessible_name(theirs)
            expect(row(page, i["tom"])).to_have_accessible_name(theirs)
    assert bullet(c, i["tom"])["text"] == theirs
    r = c.post("/api/undo", json={})
    assert r.status_code == 409 and r.json()["error"] == "nothing_to_undo"


def test_exact_undo_of_structure(app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    s0 = snapshot(c)
    steps = [("move", lambda: c.post(f"/api/bullets/{i['tom']}/move", json={"parentId": i["vol"], "index": 1}), "tom"),
             ("indent", lambda: c.post(f"/api/bullets/{i['herb']}/move", json={"op": "indent"}), "herb"),
             ("outdent", lambda: c.post(f"/api/bullets/{i['ph']}/move", json={"op": "outdent"}), "ph"),
             ("delete", lambda: c.delete(f"/api/bullets/{i['sp']}"), "sp")]
    for step, act, ref in steps:
        assert act().status_code == 200
        changed = snapshot(c)
        assert changed != s0
        u = c.post("/api/undo", json={})
        assert u.status_code == 200 and u.json()["step"] == step and u.json()["bulletId"] == i[ref]
        assert snapshot(c) == s0, f"undo of {step} must restore the exact tree"
    r = c.post("/api/redo", json={})
    assert r.status_code == 200 and r.json()["step"] == "delete"
    assert c.get(f"/api/bullets/{i['sp']}").status_code == 404
    assert c.post("/api/undo", json={}).status_code == 200
    assert snapshot(c) == s0


def test_undo_limits(browser, app_url):
    short = outage("APP_SHORT_URL")
    s = seed_world(short, outline=[{"ref": f"n{k}", "text": f"Step {k}"} for k in range(SHORT_UNDO_DEPTH + 1)])
    sc = s.owner()
    for k in range(SHORT_UNDO_DEPTH + 1):
        assert sc.patch(f"/api/bullets/{s.ids[f'n{k}']}", json={"completed": True}).status_code == 200
    for _ in range(SHORT_UNDO_DEPTH):
        assert sc.post("/api/undo", json={}).status_code == 200
    r = sc.post("/api/undo", json={})
    assert r.status_code == 409 and r.json() == {"error": "nothing_to_undo", "message": "Nothing more to undo."}
    assert bullet(sc, s.ids["n0"])["completed"] is True, "the oldest step dropped off the history"

    base = app_url.rstrip("/")
    w = seed_world(base, share="cgb")
    i, c, g = w.ids, w.owner(), w.collab()
    b = bullet(c, i["tom"])
    assert c.patch(f"/api/bullets/{i['tom']}", json={"text": "Tomatoes owner", "revision": b["revision"]}).status_code == 200
    b = bullet(g, i["tom"])
    assert g.patch(f"/api/bullets/{i['tom']}", json={"text": COLLAB_SHORT, "revision": b["revision"]}).status_code == 200
    r = c.post("/api/undo", json={})
    assert r.status_code == 409 and r.json() == {
        "error": "edited_since", "message": f"Can't undo: {w.collab_name} has edited this bullet since."}
    assert bullet(c, i["tom"])["text"] == COLLAB_SHORT
    assert c.post("/api/undo", json={}).json()["error"] == "nothing_to_undo", "the refused step is dropped"

    assert c.post(f"/api/bullets/{i['herb']}/move", json={"parentId": i["sp"], "index": 0}).status_code == 200
    assert g.delete(f"/api/bullets/{i['pp']}").status_code == 200
    r = c.post("/api/undo", json={})
    assert r.status_code == 409 and r.json() == {
        "error": "origin_gone", "message": "Can't undo: the place it came from was deleted."}
    assert bullet(c, i["herb"])["parentId"] == i["sp"]

    assert c.patch(f"/api/bullets/{i['crew']}", json={"completed": True}).status_code == 200
    assert c.post("/api/undo", json={}).status_code == 200
    assert c.patch(f"/api/bullets/{i['ret']}", json={"completed": False}).status_code == 200
    r = c.post("/api/redo", json={})
    assert r.status_code == 409 and r.json() == {"error": "nothing_to_redo", "message": "Nothing more to redo."}
    assert bullet(c, i["crew"])["completed"] is False

    fresh = seed_world(base, outline=[{"ref": "x", "text": "Only"}])
    with tab(browser, base, fresh.email, "/") as page:
        ready(page)
        page.get_by_role("button", name="Undo").click()
        expect(alert(page)).to_contain_text("Nothing more to undo.", timeout=UI_MS)
        page.get_by_role("button", name="Redo").click()
        expect(alert(page)).to_contain_text("Nothing more to redo.", timeout=UI_MS)


CENTER_JS = "e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})"


def tap_clear(locator: Locator) -> None:
    locator.evaluate(CENTER_JS)
    tap(locator)


def test_wf_phone_edit_toolbar(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="cgb")
    i, c = w.ids, w.owner()
    with tab(browser, base, w.collab_email, f"/b/{i['cgb']}", viewport=PHONE, touch=True) as page:
        ready(page)
        bar = page.get_by_role("toolbar", name="Bullet actions")
        assert bar.bounding_box()["y"] > PHONE["height"] / 2, "the toolbar is pinned to the bottom on phones"

        def press(name: str) -> None:
            tap(bar.get_by_role("button", name=name))

        tap_clear(box(row(page, i["pp"])))
        press("Indent")
        expect(status(page)).to_contain_text("Indented under Site prep #soil", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["parentId"] == i["sp"] and b["position"] == 3, "toolbar indent")
        press("Outdent")
        expect(status(page)).to_contain_text("Outdented under Community garden build", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["parentId"] == i["cgb"] and b["position"] == 1, "toolbar outdent")
        press("Move down")
        expect(status(page)).to_contain_text("Moved to position 3 of 3 under Community garden build", timeout=UI_MS)
        press("Move up")
        expect(status(page)).to_contain_text("Moved to position 2 of 3 under Community garden build", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["position"] == 1, "toolbar moves")
        press("Complete")
        expect(status(page)).to_contain_text("Completed Planting plan", timeout=UI_MS)
        expect(bar.get_by_role("button", name="Complete")).to_have_attribute("aria-pressed", "true")
        until_bullet(c, i["pp"], lambda b: b["completed"] is True, "toolbar complete")
        press("Collapse")
        expect(status(page)).to_contain_text("Collapsed Planting plan", timeout=UI_MS)
        expect(bar.get_by_role("button", name="Collapse")).to_have_attribute("aria-pressed", "true")
        until_bullet(c, i["pp"], lambda b: b["collapsed"] is True, "toolbar collapse")
        press("Collapse")
        expect(status(page)).to_contain_text("Expanded Planting plan", timeout=UI_MS)
        tap_clear(box(row(page, i["crew"])))
        press("Delete bullet")
        expect(status(page)).to_contain_text("Moved Saturday crew @Mira to trash", timeout=UI_MS)
        until_status(c, f"/api/bullets/{i['crew']}", 404, "toolbar delete trashes the bullet")
        tap_clear(box(row(page, i["herb"])))
        press("Mirror")
        expect(status(page)).to_contain_text(f"Mirrored {T['herb']}", timeout=UI_MS)
        poll(lambda: any(b["mirrorOf"] == i["herb"] and b["parentId"] == i["pp"] and b["position"] == 2
                         for b in c.get("/api/outline").json()["bullets"]), "toolbar mirror places the copy below")
        tap_clear(box(row(page, i["pp"])))
        press("Zoom in")
        expect(page).to_have_url(url_is(f"/b/{i['pp']}"), timeout=UI_MS)
        expect(status(page)).to_contain_text("Zoomed into Planting plan")
        press("Zoom out")
        expect(page).to_have_url(url_is(f"/b/{i['cgb']}"), timeout=UI_MS)
        expect(status(page)).to_contain_text(re.compile(rf"Zoomed out to (Home|{re.escape(T['cgb'])})"))


def test_wf_phone_edit_toolbar_refusal(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="cgb")
    i, c, g = w.ids, w.owner(), w.collab()
    before = snapshot(c)
    with tab(browser, base, w.collab_email, f"/b/{i['cgb']}", viewport=PHONE, touch=True) as page:
        ready(page)
        bar = page.get_by_role("toolbar", name="Bullet actions")
        tap(box(row(page, i["sp"])))
        tap(bar.get_by_role("button", name="Outdent"))
        expect(alert(page)).to_contain_text("Can't outdent: it is already at the top level.", timeout=UI_MS)
        tap(bar.get_by_role("button", name="Move up"))
        expect(alert(page)).to_contain_text("Can't move up: it is already first.", timeout=UI_MS)
        tap(bar.get_by_role("button", name="Indent"))
        expect(alert(page)).to_contain_text("Can't indent: there is no bullet above it at this level.", timeout=UI_MS)
    root_copy = "The shared bullet stays where its owner put it."
    for r in (g.delete(f"/api/bullets/{i['cgb']}"), g.post(f"/api/bullets/{i['cgb']}/move", json={"op": "down"})):
        assert r.status_code == 409 and r.json() == {"error": "share_root", "message": root_copy}
    assert snapshot(c) == before


def _swipe(page: Page, target: Locator, dx: float) -> None:
    cdp = session(page)
    bb = target.bounding_box()
    y = bb["y"] + bb["height"] / 2
    x0 = bb["x"] + bb["width"] / 2 - dx / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
    for k in range(1, SWIPE_STEPS + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + dx * k / SWIPE_STEPS, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_touch_gestures_and_targets(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    assert SWIPE_PX >= SWIPE_MIN_PX
    with tab(browser, base, w.email, "/", viewport=PHONE, touch=True) as page:
        ready(page)
        bar = page.get_by_role("toolbar", name="Bullet actions")
        controls = [page.get_by_role("button", name=n) for n in
                    ("Undo", "Redo", "Download", "Go back", "Go forward", "Go home", "Show as board", "Menu")]
        controls += [page.get_by_role("switch", name="Hide completed")]
        controls += [bar.get_by_role("button", name=n) for n in
                     ("Indent", "Outdent", "Move up", "Move down", "Collapse", "Complete", "Zoom in", "Zoom out",
                      "Mirror", "Delete bullet")]
        controls += [page.get_by_role("link", name=f"Zoom into {T['cgb']}"),
                     page.get_by_role("button", name=f"Toggle children of {T['cgb']}")]
        for loc in controls:
            loc.scroll_into_view_if_needed()
            bb = loc.bounding_box()
            assert bb and bb["width"] >= TOUCH_MIN_PX and bb["height"] >= TOUCH_MIN_PX, f"small target: {loc} {bb}"
        for ref in ("cgb", "sp", "pp", "tom", "we"):
            bb = box(row(page, i[ref])).bounding_box()
            assert bb["height"] >= TOUCH_MIN_PX, f"{ref} row is {bb['height']} px tall"
        _swipe(page, box(row(page, i["pp"])), SWIPE_PX)
        expect(status(page)).to_contain_text("Indented under Site prep #soil", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["parentId"] == i["sp"], "a right swipe indents")
        _swipe(page, box(row(page, i["pp"])), -SWIPE_PX)
        expect(status(page)).to_contain_text("Outdented under Community garden build", timeout=UI_MS)
        until_bullet(c, i["pp"], lambda b: b["parentId"] == i["cgb"], "a left swipe outdents")
        tap(page.get_by_role("link", name=f"Zoom into {T['cgb']}"))
        expect(page).to_have_url(url_is(f"/b/{i['cgb']}"), timeout=UI_MS)
        share = page.get_by_role("button", name="Share")
        bb = share.bounding_box()
        assert bb["width"] >= TOUCH_MIN_PX and bb["height"] >= TOUCH_MIN_PX
        tap(share)
        dialog = page.get_by_role("dialog", name="Share bullet")
        for name in ("Send invitation", "Close"):
            bb = dialog.get_by_role("button", name=name).bounding_box()
            assert bb["width"] >= TOUCH_MIN_PX and bb["height"] >= TOUCH_MIN_PX


HOME_TEXT = [
    "- Community garden build",
    "  - Site prep #soil",
    "    - Clear the lot !(2026-11-07) (completed)",
    "    - Test soil pH #soil @Mira",
    "    - Buy compost bags #soil (mirror)",
    "  - Planting plan",
    "    - Tomatoes #seedlings",
    "    - Herb spiral @Jonah !(2026-11-12)",
    "    - Native wildflowers #seedlings (completed)",
    "  - Volunteers",
    "    - Saturday crew @Mira",
    "    - Tool library sign-out",
    "      - Borrow the wheelbarrow !(2026-11-08)",
    "- Weekly errands",
    "  - Buy compost bags #soil",
    "  - Return library books (completed)",
]

PP_MARKDOWN = ["# Planting plan", "", "- Tomatoes #seedlings", "- Herb spiral @Jonah !(2026-11-12)",
               "- [x] Native wildflowers #seedlings"]


def _lines(body: str) -> list[str]:
    out = body.replace("\r\n", "\n").split("\n")
    while out and out[-1] == "":
        out.pop()
    return out


def test_downloads(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    assert c.patch("/api/me", json={"hideCompleted": True}).status_code == 200
    r = c.get("/api/export", params={"format": "text"})
    assert r.status_code == 200 and _ctype(r.headers["content-type"]) == _ctype("text/plain; charset=utf-8")
    disposition = r.headers.get("content-disposition", "")
    assert "attachment" in disposition and "twigline-home.txt" in disposition
    assert _lines(r.text) == HOME_TEXT
    md = c.get("/api/export", params={"format": "markdown", "root": i["pp"]})
    assert _ctype(md.headers["content-type"]) == _ctype("text/markdown; charset=utf-8")
    assert f"twigline-{_slug(T['pp'])}.md" in md.headers.get("content-disposition", "")
    assert _lines(md.text) == PP_MARKDOWN
    op = c.get("/api/export", params={"format": "opml"})
    assert _ctype(op.headers["content-type"]) == _ctype("text/x-opml; charset=utf-8")
    assert "twigline-home.opml" in op.headers.get("content-disposition", "")
    assert op.text.lstrip().startswith('<?xml version="1.0" encoding="UTF-8"?>')
    doc = ET.fromstring(op.text.encode())
    assert doc.tag == "opml" and doc.get("version") == "2.0"
    assert doc.find("head/title").text == "Home"
    nodes = {n.get("_id"): n for n in doc.iter("outline")}
    assert doc.find("body/outline").get("_id") == i["cgb"]
    assert nodes[i["sp"]].find("outline").get("_id") == i["clear"]
    clear = nodes[i["clear"]]
    assert clear.get("text") == T["clear"] and clear.get("_complete") == "true" and clear.get("_date") == "2026-11-07"
    ph = nodes[i["ph"]]
    assert ph.get("_tags") == "soil" and ph.get("_mentions") == "mira" and ph.get("_complete") is None
    assert ph.get("_date") is None
    assert nodes[i["bcopy"]].get("_mirrorOf") == i["buy"]
    assert c.get("/api/export", params={"format": "pdf"}).status_code == 422
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        page.get_by_role("button", name="Download").click()
        menu = page.get_by_role("menu")
        for name in ("Plain text", "Markdown", "OPML"):
            expect(menu.get_by_role("menuitem", name=name)).to_be_visible()
        with page.expect_download() as info:
            menu.get_by_role("menuitem", name="Markdown").click()
        download = info.value
        assert download.suggested_filename == f"twigline-{_slug(T['pp'])}.md"
        assert _lines(Path(download.path()).read_text(encoding="utf-8")) == PP_MARKDOWN
    assert c.delete(f"/api/bullets/{i['buy']}").status_code == 200
    after = _lines(c.get("/api/export", params={"format": "text"}).text)
    assert f"    - {PLACEHOLDER} (mirror)" in after and f"  - {T['buy']}" not in after


def test_wf_phone_edit_download_branch(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c, g = w.ids, w.owner(), w.collab()
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}", viewport=PHONE, touch=True) as page:
        ready(page)
        _swipe(page, box(row(page, i["herb"])), SWIPE_PX)
        expect(status(page)).to_contain_text(f"Indented under {T['tom']}", timeout=UI_MS)
        until_bullet(c, i["herb"], lambda b: b["parentId"] == i["tom"], "a right swipe indents under Tomatoes")
        tap(box(row(page, i["tom"])))
        tap(page.get_by_role("toolbar", name="Bullet actions").get_by_role("button", name="Complete"))
        expect(status(page)).to_contain_text(f"Completed {T['tom']}", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["completed"] is True, "the toolbar completion is saved")
        tap(page.get_by_role("button", name="Download"))
        item = page.get_by_role("menu").get_by_role("menuitem", name="Plain text")
        expect(item).to_be_visible(timeout=UI_MS)
        with page.expect_download() as info:
            tap(item)
        download = info.value
        assert download.suggested_filename == f"twigline-{_slug(T['pp'])}.txt"
        assert _lines(Path(download.path()).read_text(encoding="utf-8")) == [
            f"- {T['tom']} (completed)", f"  - {T['herb']}", f"- {T['wild']} (completed)"]
    r = g.get("/api/export", params={"format": "opml", "root": i["pp"]})
    assert r.status_code == 200
    nodes = {n.get("_id"): n for n in ET.fromstring(r.text.encode()).iter("outline")}
    tom, herb = nodes[i["tom"]], nodes[i["herb"]]
    assert tom.get("_complete") == "true" and tom.get("_tags") == "seedlings"
    assert herb in list(tom), "the swiped bullet is nested inside Tomatoes in the OPML"
    assert herb.get("_date") == "2026-11-12" and herb.get("_mentions") == "jonah" and herb.get("_complete") is None
    assert bullet(c, i["herb"])["completed"] is False


APP = Path("/app")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), f"run.json {key} must be a command string"


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"
    for font in ("Inter", "Noto Sans"):
        assert font in notices, f"font {font} is not listed"


def test_if_licences_allowed():
    bad = [(p.name, getattr(p, "licence", None)) for p in shipped_packages()
           if not licence_allowed(getattr(p, "licence", "") or "", ALLOWLIST)]
    assert not bad, f"packages with licences outside the allowlist: {bad[:20]}"


FORBIDDEN_STORES = {"sqlite3", "better-sqlite3", "@libsql/client", "lowdb", "nedb", "mongodb", "mysql", "mysql2",
                    "level", "lmdb", "kafkajs", "amqplib"}


def test_if_only_provided_stores():
    names = {p.name for p in shipped_packages()}
    assert not names & FORBIDDEN_STORES, f"forbidden datastore packages: {names & FORBIDDEN_STORES}"
    found: list[str] = []
    for path in APP.rglob("*"):
        if "node_modules" in path.parts or ".git" in path.parts:
            continue
        if path.suffix in {".sqlite", ".sqlite3", ".db"}:
            found.append(str(path))
        if len(found) > 5:
            break
    assert not found, f"file data stores present: {found}"


def test_if_lockfile_and_same_origin(browser, app_url):
    assert (APP / "package-lock.json").is_file()
    base = app_url.rstrip("/")
    w = seed_world(base)
    foreign: list[str] = []
    with tab(browser, base, None, "/") as page:
        page.on("request", lambda r: foreign.append(r.url)
                if r.url.startswith("http") and not same_origin(r.url, base) else None)
        page.reload()
        expect(page.get_by_role("link", name="Start your outline").first).to_be_visible(timeout=UI_MS)
    with tab(browser, base, w.email, "/",
             before=lambda p: p.on("request", lambda r: foreign.append(r.url)
                                   if r.url.startswith("http") and not same_origin(r.url, base) else None)) as page:
        ready(page)
    assert not foreign, f"requests to other origins: {foreign[:10]}"


def test_if_services_untouched(mail, valkey):
    assert _helper("Postgres")().tables(), "Postgres answers to the seeded observer credentials"
    assert valkey.command("PING") in ("PONG", b"PONG", True)
    assert isinstance(mail.messages(), list)


CM_ROW_ORDER_JS = """(el) => Array.from(el.querySelectorAll('[role="treeitem"]')).map(n => n.getAttribute('data-bullet-id'))"""


def test_wf_complete_hide_typed_then_completed(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    typed = f"{T['tom']} now"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["tom"])
        page.keyboard.type(" now")
        page.keyboard.press("Control+Enter")
        expect(status(page)).to_contain_text(f"Completed {T['tom']}", timeout=UI_MS)
        expect(row(page, i["tom"])).to_have_attribute("data-completed", "true", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["completed"] is True and b["text"] == typed,
                     "the completion and the text typed just before it are both saved")
        expect(row(page, i["tom"])).to_have_accessible_name(typed, timeout=UI_MS)
        expect(alert(page)).not_to_contain_text("changed this bullet first")


def test_wf_mirror_edit_copy_focus_in_place(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["pp"])
        page.keyboard.press("Control+Shift+M")
        expect(status(page)).to_contain_text(f"Mirrored {T['pp']}", timeout=UI_MS)
        poll(lambda: any(b["mirrorOf"] == i["pp"] for b in outline(c)), "a copy of Planting plan exists")
        pcopy = next(b["id"] for b in outline(c) if b["mirrorOf"] == i["pp"])
        held = row(page, pcopy)
        expect(held).to_have_attribute("data-mirror-of", i["pp"], timeout=UI_MS)
        inner_tom = held.get_by_role("treeitem").and_(page.locator(f'[data-bullet-id="{i["tom"]}"]')).first
        box(inner_tom).click()
        page.keyboard.press("End")
        expect(inner_tom).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        page.keyboard.press("Control+Shift+M")
        expect(status(page)).to_contain_text(f"Mirrored {T['tom']}", timeout=UI_MS)
        poll(lambda: any(b["mirrorOf"] == i["tom"] for b in outline(c)), "a copy of Tomatoes exists")
        tcopy = next(b for b in outline(c) if b["mirrorOf"] == i["tom"])
        assert tcopy["parentId"] == i["pp"] and tcopy["position"] == 1, "the copy is the next sibling of Tomatoes"
        below = held.get_by_role("treeitem").and_(page.locator(f'[data-bullet-id="{tcopy["id"]}"]')).first
        expect(below).to_have_attribute("data-mirror-of", i["tom"], timeout=UI_MS)
        order = held.evaluate(CM_ROW_ORDER_JS)
        assert order.index(tcopy["id"]) == order.index(i["tom"]) + 1, \
            f"inside the copy of Planting plan the new copy sits directly below Tomatoes: {order}"
        expect(below).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(box(below)).to_be_focused()


def test_wf_mirror_edit_focused_copy_live(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    edited = f"{T['buy']} sacks"
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        focus(other, i["bcopy"])
        copy_box = box(row(other, i["bcopy"]))
        expect(copy_box).to_be_focused()
        page.bring_to_front()
        focus(page, i["buy"])
        page.keyboard.type(" sacks")
        page.keyboard.press("Escape")
        until_bullet(c, i["buy"], lambda b: b["text"] == edited, "the text typed in the original is saved")
        expect(row(other, i["bcopy"])).to_have_accessible_name(edited, timeout=LIVE_MS)
        poll(lambda: copy_box.evaluate(VALUE_JS) == edited,
             "the copy's textbox in the second tab shows the original's new text", LIVE_MS / 1000)
        assert_no_reload(other)


def _co_value(locator) -> str:
    return locator.evaluate(VALUE_JS)


def test_wf_co_edit_completion_while_typing(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    typed = f"{T['tom']} mine"
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
        ready(guest)
        with clocked(browser, base, w.email, f"/b/{i['pp']}") as page:
            eventually(page, lambda: expect(row(page, i["tom"])).to_be_visible(timeout=CHECK_MS), "branch loads")
            click(box(row(page, i["tom"])))
            page.keyboard.press("End")
            page.keyboard.type(" mine")
            focus(guest, i["tom"])
            guest.keyboard.press("Control+Enter")
            until_bullet(c, i["tom"], lambda b: b["completed"] is True, "the collaborator's completion is saved")

            def seen():
                expect(row(page, i["tom"])).to_have_attribute("data-completed", "true", timeout=LIVE_MS // 2)
                assert _co_value(box(row(page, i["tom"]))) == typed, "the owner's unsaved text was replaced"

            eventually(page, seen, "the completion shows in the typing tab while its unsaved text stays", steps=3)


def test_wf_co_edit_live_text_in_focused_row(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    ready_text = f"{T['tom']} ready"
    now_text = f"{ready_text} now"
    with tab(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
        ready(guest)
        mark_no_reload(guest)
        with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
            ready(page)
            focus(guest, i["tom"])
            guest.keyboard.type(" ready")
            until_bullet(c, i["tom"], lambda b: b["text"] == ready_text, "the collaborator's text is saved")
            expect(row(page, i["tom"])).to_have_accessible_name(ready_text, timeout=LIVE_MS)
            focus(page, i["tom"])
            page.keyboard.type(" now")
            page.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == now_text, "the owner's text is saved")
            expect(row(guest, i["tom"])).to_have_attribute("aria-selected", "true")
            poll(lambda: _co_value(box(row(guest, i["tom"]))).strip() == now_text,
                 "the collaborator's focused textbox shows the owner's saved text", seconds=LIVE_MS / 1000)
            guest.keyboard.press("End")
            guest.keyboard.type(" too")
            guest.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == f"{now_text} too",
                         "the collaborator's next save keeps the owner's text")
        assert_no_reload(guest)


def test_wf_co_edit_stale_split_refused(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="pp")
    i, c = w.ids, w.owner()
    owner_text = f"{T['tom']} now"
    notice = f"{w.name} changed this bullet first. Their text is shown; your edit was not saved."
    with tab(browser, base, w.email, f"/b/{i['pp']}") as page:
        ready(page)
        with clocked(browser, base, w.collab_email, f"/b/{i['pp']}") as guest:
            eventually(guest, lambda: expect(row(guest, i["tom"])).to_be_visible(timeout=CHECK_MS), "branch loads")
            click(box(row(guest, i["tom"])))
            guest.keyboard.press("End")
            guest.keyboard.type(" mine")
            focus(page, i["tom"])
            page.keyboard.type(" now")
            page.keyboard.press("Escape")
            until_bullet(c, i["tom"], lambda b: b["text"] == owner_text, "the owner's text is saved first")
            guest.keyboard.press("ArrowLeft")
            guest.keyboard.press("ArrowLeft")
            guest.keyboard.press("Enter")
            eventually(guest, lambda: expect(alert(guest)).to_contain_text(notice, timeout=CHECK_MS),
                       "the collaborator's tab shows the conflict notice naming the owner")

            def winning():
                assert _co_value(box(row(guest, i["tom"]))).strip() == owner_text, \
                    "the collaborator's textbox shows the owner's winning text"

            eventually(guest, winning, "the collaborator's textbox shows the owner's winning text")
    assert bullet(c, i["tom"])["text"] == owner_text


def test_wf_co_edit_moves_settle_every_tab(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base, share="sh", outline=[{"ref": "sh", "text": "Shared shelf", "children": [
        {"ref": "p1", "text": "Left bay", "children": [{"ref": "a", "text": "Apple crate"}]},
        {"ref": "p2", "text": "Right bay", "children": [{"ref": "b", "text": "Banana crate"}]}]}])
    i, c, g = w.ids, w.owner(), w.collab()
    with tab(browser, base, w.email, f"/b/{i['sh']}") as page, \
            tab(browser, base, w.collab_email, f"/b/{i['sh']}") as guest:
        ready(page)
        ready(guest)
        results = fire([lambda: c.post(f"/api/bullets/{i['a']}/move", json={"parentId": i["b"], "index": 0}),
                        lambda: g.post(f"/api/bullets/{i['b']}/move", json={"parentId": i["a"], "index": 0})])
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409], codes
        loser = next(r for r in results if r.status_code == 409)
        assert loser.json() == {"error": "inside_itself", "message": "Can't place a bullet inside itself."}
        a, b = bullet(c, i["a"]), bullet(c, i["b"])
        assert (a["parentId"] == i["b"]) != (b["parentId"] == i["a"]), "exactly one bullet ends inside the other"
        parent, child = (i["b"], i["a"]) if a["parentId"] == i["b"] else (i["a"], i["b"])
        for p in (page, guest):
            p.wait_for_function(INSIDE_JS, arg=[parent, child], timeout=LIVE_MS)
            assert not p.evaluate(INSIDE_JS, [child, parent])
            expect(row(p, child)).to_have_attribute("aria-level", "3")
            expect(row(p, child)).to_have_attribute("data-depth", "3")
            expect(row(p, parent)).to_have_attribute("aria-level", "2")


MI_FOCUS_IN_JS = """(id) => {
  const a = document.activeElement;
  const item = a ? a.closest('[role="treeitem"]') : null;
  return !!item && item.getAttribute('data-bullet-id') === id;
}"""


def test_wf_move_across_focus_beside_copy(browser, app_url):
    base = app_url.rstrip("/")
    tree_seed = seed_outline()
    tree_seed.insert(0, {"ref": "wecopy", "mirrorOf": "we"})
    w = seed_world(base, outline=tree_seed)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        target = row(page, i["we"]).get_by_role("treeitem").and_(page.locator(f'[data-bullet-id="{i["ret"]}"]'))
        box(target).click()
        page.keyboard.press("End")
        expect(target).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        page.keyboard.press("Control+ArrowUp")
        expect(status(page)).to_contain_text(f"Moved to position 1 of 2 under {T['we']}", timeout=UI_MS)
        until_bullet(c, i["ret"], lambda b: b["parentId"] == i["we"] and b["position"] == 0, "swapped up")
        page.wait_for_function(ORDER_JS, arg=[i["ret"], i["buy"]], timeout=UI_MS)
        expect(target).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(page.get_by_role("treeitem", selected=True)).to_have_count(1)
        assert target.evaluate("el => el.contains(document.activeElement)"), "focus left the row it was on"
        assert bool(target.evaluate(RING_JS)) or bool(box(target).evaluate(RING_JS)), "the ring left the row"


def test_wf_indent_edges_outdent_second_tab(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        other = another_tab(page, base, "/")
        ready(other)
        mark_no_reload(other)
        other.wait_for_function(INSIDE_JS, arg=[i["sp"], i["ph"]], timeout=UI_MS)
        focus(page, i["ph"])
        page.keyboard.press("Shift+Tab")
        expect(status(page)).to_contain_text(f"Outdented under {T['cgb']}", timeout=UI_MS)
        until_bullet(c, i["ph"], lambda b: b["parentId"] == i["cgb"] and b["position"] == 1, "placed after Site prep")
        assert bullet(c, i["bcopy"])["parentId"] == i["sp"], "the later sibling stays under the old parent"
        other.wait_for_function(
            """([sp, ph, cgb]) => {
              const f = (id) => document.querySelector('[role="treeitem"][data-bullet-id="' + id + '"]');
              const a = f(sp), b = f(ph), g = f(cgb);
              return !!a && !!b && !!g && !a.contains(b) && g.contains(b)
                && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
            }""", arg=[i["sp"], i["ph"], i["cgb"]], timeout=LIVE_MS)
        expect(row(other, i["ph"])).to_have_attribute("aria-level", "2")
        other.wait_for_function(INSIDE_JS, arg=[i["sp"], i["bcopy"]], timeout=UI_MS)
        assert_no_reload(other)


def test_wf_indent_edges_delete_first_focus(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    with tab(browser, base, w.email, "/") as page:
        ready(page)
        focus(page, i["cgb"])
        page.keyboard.press("Control+Shift+Backspace")
        dialog = menu_dialog(page, "Delete bullet")
        expect(dialog).to_be_visible(timeout=UI_MS)
        expect(dialog).to_contain_text(f"Delete {T['cgb']} and the ")
        dialog.get_by_role("button", name="Delete", exact=True).click()
        expect(status(page)).to_contain_text(f"Moved {T['cgb']} to trash", timeout=UI_MS)
        expect(row(page, i["cgb"])).to_have_count(0, timeout=UI_MS)
        expect(row(page, i["we"])).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        page.wait_for_function(MI_FOCUS_IN_JS, arg=i["we"], timeout=UI_MS)
    for ref in ("cgb", "sp", "tom", "wheel"):
        until_status(c, f"/api/bullets/{i[ref]}", 404, f"{ref} is in the trash")


def test_wf_search_operators_escape_before_pause(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i = w.ids
    with tab(browser, base, w.email, "/", before=lambda p: p.clock.install()) as page:
        ready(page)
        mark_no_reload(page)
        search = searchbox(page)
        search.click()
        search.press_sequentially("#soil")
        search.press("Escape")
        expect(search).to_have_value("")
        page.clock.run_for(1000)
        for ref in ("pp", "tom", "crew", "ret"):
            expect(row(page, i[ref])).to_be_visible(timeout=UI_MS)
        for ref in ("cgb", "sp", "we"):
            assert row(page, i[ref]).get_attribute("data-search") is None, \
                f"{T[ref]} still carries data-search after Escape cleared the search"
        expect(row(page, i["tool"])).to_have_attribute("data-collapsed", "true")
        assert_no_reload(page)


def test_wf_board_view_same_position_live(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    path = f"/b/{i['cgb']}?view=board"
    with tab(browser, base, w.email, path) as page:
        expect(page.get_by_role("region", name=T["pp"])).to_be_visible(timeout=UI_MS)
        other = another_tab(page, base, path)
        expect(other.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True)
               ).to_be_visible(timeout=UI_MS)
        mark_no_reload(other)
        page.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True).focus()
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(
            f"Picked up {T['tom']}. Use the arrow keys to move it, Space to drop, Escape to cancel.", timeout=UI_MS)
        page.keyboard.press("ArrowLeft")
        expect(status(page)).to_contain_text(f"{T['tom']}: position 1 of 4 in {T['sp']}", timeout=UI_MS)
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(f"Dropped {T['tom']} in {T['sp']}, position 1 of 4", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["sp"] and b["position"] == 0,
                     "the dropped card is saved first under Site prep")
        moved = other.get_by_role("region", name=T["sp"]).get_by_role("listitem", name=T["tom"], exact=True)
        expect(moved).to_be_visible(timeout=LIVE_MS)
        expect(other.get_by_role("region", name=T["sp"]).get_by_role("listitem").first
               ).to_have_attribute("data-bullet-id", i["tom"])
        expect(other.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True)
               ).to_have_count(0)
        assert_no_reload(other)


def test_wf_board_view_keyboard_after_live_move(browser, app_url):
    base = app_url.rstrip("/")
    w = seed_world(base)
    i, c = w.ids, w.owner()
    path = f"/b/{i['cgb']}?view=board"
    with tab(browser, base, w.email, path) as page:
        pp = page.get_by_role("region", name=T["pp"])
        vol = page.get_by_role("region", name=T["vol"])
        expect(pp.get_by_role("listitem")).to_have_count(3, timeout=UI_MS)
        other = another_tab(page, base, path)
        expect(other.get_by_role("region", name=T["pp"])).to_be_visible(timeout=UI_MS)
        other.get_by_role("region", name=T["pp"]).get_by_role("listitem", name=T["tom"], exact=True).focus()
        other.keyboard.press("Space")
        expect(status(other)).to_contain_text(f"Picked up {T['tom']}.", timeout=UI_MS)
        other.keyboard.press("ArrowRight")
        expect(status(other)).to_contain_text(f"{T['tom']}: position 1 of 3 in {T['vol']}", timeout=UI_MS)
        other.keyboard.press("ArrowDown")
        other.keyboard.press("ArrowDown")
        expect(status(other)).to_contain_text(f"{T['tom']}: position 3 of 3 in {T['vol']}", timeout=UI_MS)
        other.keyboard.press("Space")
        expect(status(other)).to_contain_text(f"Dropped {T['tom']} in {T['vol']}, position 3 of 3", timeout=UI_MS)
        until_bullet(c, i["tom"], lambda b: b["parentId"] == i["vol"] and b["position"] == 2,
                     "the second tab's move is saved")
        expect(vol.get_by_role("listitem", name=T["tom"], exact=True)).to_be_visible(timeout=LIVE_MS)
        expect(pp.get_by_role("listitem")).to_have_count(2, timeout=UI_MS)
        pp.get_by_role("listitem", name=T["herb"], exact=True).focus()
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(
            f"Picked up {T['herb']}. Use the arrow keys to move it, Space to drop, Escape to cancel.", timeout=UI_MS)
        page.keyboard.press("ArrowUp")
        expect(pp.get_by_role("listitem")).to_have_count(2, timeout=UI_MS)
        expect(pp.get_by_role("listitem", name=T["tom"], exact=True)).to_have_count(0)
        expect(vol.get_by_role("listitem", name=T["tom"], exact=True)).to_be_visible()
        page.keyboard.press("ArrowDown")
        expect(status(page)).to_contain_text(f"{T['herb']}: position 2 of 2 in {T['pp']}", timeout=UI_MS)
        page.keyboard.press("Space")
        expect(status(page)).to_contain_text(f"Dropped {T['herb']} in {T['pp']}, position 2 of 2", timeout=UI_MS)
        until_bullet(c, i["herb"], lambda b: b["parentId"] == i["pp"] and b["position"] == 1,
                     "the dropped card is saved second in Planting plan")
        expect(pp.get_by_role("listitem")).to_have_count(2, timeout=UI_MS)
        expect(vol.get_by_role("listitem")).to_have_count(3)
