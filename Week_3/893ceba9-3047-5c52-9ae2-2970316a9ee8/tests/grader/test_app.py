from __future__ import annotations

import base64
import contextlib
import csv
import hashlib
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
from concurrent.futures import ThreadPoolExecutor
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    check,
    click,
    fill,
    layout,
    licence_allowed,
    open_app,
    project_dirs,
    same_origin,
    select,
    shipped_packages,
    state_styles,
    style,
    unique,
)


OWNER_EMAIL = "robin@marlowquill.example"
OWNER_NAME = "Robin Achterberg"
OWNER_PASSWORD = "interline-demo-2026"
SEED_SLUG = "larkspur-rider"
SEED_NAME = "Larkspur Rider"
SEED_BRANCH = "feature/checkout-redesign"
JSON_LIMIT = 1_000_000
FILE_LIMIT = 5_000_000
HEALTH_WITHIN_S = 60
SESSION_HOURS = 12
MQM_PENALTY = {"minor": 1, "major": 5, "critical": 25}
MQM_MIN_WORDS = 10
MQM_FULL = 100
DEFAULT_THRESHOLD = 90
PR_NUMBER = 42
PR_URL = "https://git.example.test/larkspur-cycles/rider-app/pull/42"
GIT_ATTEMPTS = 3
CONFIRM_WINDOW_S = 30
WEBHOOK_RETRY_S = 10
UI_MAX_MS = 500
INSTANT_MS = 1
MARQUEE_PASS_MS = 20_000
MARQUEE_PASSES = 2
TOUCH_PX = 44
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
ACCESS_KEY_RE = re.compile(r"^rvk_[A-Za-z0-9]{24}$")
ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "0BSD", "MPL-2.0", "Unicode-3.0", "OFL-1.1"}
AI_DRAFT = {"de": "Entwurf der Lexa-Testmaschine", "fr": "Ébauche de la machine d'essai Lexa", "ja": "レクサ試験エンジンの下書き"}
AI_ISSUE = {"de": [("fluency", "minor", "Word order reads stiffly.")], "fr": [], "ja": [("accuracy", "major", "Meaning drifts from the source.")]}
HERO_LINES = ("Keep every string.", "Branch without losing one.", "Publish what you approved.")
HERO_LEAD = "Translation memory, branches, AI drafts and MQM review for the engineer who runs several client apps alone."
HERO_IMG = "Three locale files with MQM, match and conflict figures"
HERO_CHIPS = ("MQM 96", "312 exact matches reused", "2 branch conflicts open", "Example")
POSTURE_TITLES = ("One session cookie", "Files kept as submitted", "Exact restore", "Erasure on request", "Signed webhooks", "Scoped reviewer access", "Per-project CI tokens", "Six-month audit log", "Formula-safe exports", "Same-origin only", "Your own storage", "No trackers")
NOTICE_TEXT = "Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies."
NOTICE_MORE = "Your choice to hide this notice is remembered in this browser only."
WORKFLOW_BUTTONS = ("Import translation memory", "Upload source file", "Draft with AI", "Assign review", "Merge a branch", "Publish")
BANNER_GIT = ("Repository host outage", "The repository host isn't answering. Publishing will fail until it's back; your strings are safe here.")
BANNER_AI = ("AI engine outage", "The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.")
BANNER_HOOK = ("Webhook outage", "Webhook delivery is paused. Events are kept and sent once the service is back.")
HHMM = re.compile(r"\b\d{2}:\d{2}\b")
DURATION = "transition" + "-duration"


REQUEST_TIMEOUT_S = 30
POLL_S = 0.25
UI_WAIT_S = 20
NOTICE_WAIT_S = 8
STEP_MS = 100
SHORT_WAIT_S = 45
PUBLISH_WAIT_S = 40
COPY_STOP_S = 20
SINK_URL = "http://127.0.0.1:9/ci-hook"
SINK_URL_2 = "http://127.0.0.1:9/ci-hook-two"
_TICK = threading.Event()

SEED_KEYS = [
    ("app.title", "Larkspur Rider"),
    ("nav.home", "Home"),
    ("nav.rides", "Rides"),
    ("nav.garage", "Garage"),
    ("nav.profile", "Profile"),
    ("home.greeting", "Welcome back, {name}."),
    ("home.weekly_distance", "You rode {distance} km this week."),
    ("home.start_ride", "Start a ride"),
    ("rides.empty", "No rides yet."),
    ("rides.filter.all", "All rides"),
    ("rides.filter.month", "This month"),
    ("rides.detail.duration", "Duration"),
    ("rides.detail.elevation", "Elevation gain"),
    ("rides.detail.share", "Share ride"),
    ("garage.add_bike", "Add a bike"),
    ("garage.service_due", "Service due in {days} days"),
    ("garage.tyre_pressure", "Tyre pressure"),
    ("garage.chain_wear", "Chain wear"),
    ("profile.edit", "Edit profile"),
    ("profile.units", "Units"),
    ("profile.units.metric", "Metric"),
    ("profile.units.imperial", "Imperial"),
    ("profile.sign_out", "Sign out"),
    ("settings.notifications", "Notifications"),
    ("settings.privacy", "Privacy"),
    ("settings.language", "Language"),
    ("cart.title", "Your basket"),
    ("cart.empty", "Your basket is empty."),
    ("cart.item_count", "{count} items"),
    ("cart.remove", "Remove"),
    ("checkout.title", "Checkout"),
    ("checkout.summary.title", "Basket summary"),
    ("checkout.shipping", "Shipping"),
    ("checkout.total", "Total: {amount}"),
    ("checkout.cta.pay", "Pay now"),
    ("checkout.success", "Thanks, {name}. Your order is on its way."),
    ("errors.network", "Check your connection and try again."),
    ("errors.payment_declined", "Your payment was declined."),
    ("errors.generic", "Something went wrong."),
    ("legal.terms", "Terms of service"),
]
SEED_DE = ["Larkspur Rider", "Start", "Fahrten", "Garage", "Profil", "Willkommen zurück, {name}.", "Du bist diese Woche {distance} km gefahren.", "Fahrt starten", "Noch keine Fahrten.", "Alle Fahrten", "Diesen Monat", "Dauer"]
SEED_FR = ["Larkspur Rider", "Accueil", "Sorties", "Garage", "Profil", "Bon retour, {name}.", "Vous avez roulé {distance} km cette semaine.", "Démarrer une sortie"]
SEED_JA = ["Larkspur Rider", "ホーム", "ライド", "ガレージ", "プロフィール"]
SEED_TM = {("Remove", "de", "Entfernen"), ("Remove", "fr", "Retirer"), ("Checkout", "de", "Kasse"), ("Total: {amount}", "de", "Summe: {amount}"), ("Sign out", "de", "Abmelden"), ("Sign out", "fr", "Se déconnecter")}
SEGMENT_FIELDS = ("id", "key_id", "key", "source", "language", "value", "status", "score", "origin", "issues", "comments", "removed")
MAJOR = {"category": "accuracy", "severity": "major"}
MINOR = {"category": "fluency", "severity": "minor"}
CRITICAL = {"category": "terminology", "severity": "critical"}


def enc(name: str) -> str:
    return quote(name, safe="")


def tag(prefix: str = "tag") -> str:
    name, email = unique(prefix)
    return hashlib.sha1(f"{name}|{email}".encode()).hexdigest()[:8]


def fresh(prefix: str) -> str:
    return f"ivt-{prefix}-{tag(prefix)}{tag(prefix)[:2]}"


def person(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    email = a if "@" in a else b
    name = b if email == a else a
    if "@" not in email:
        email = f"{prefix}-{tag(prefix)}@interline.example"
    return name, email


def poll(fetch, accept, seconds: float, contract: str):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if accept(last):
            return last
        _TICK.wait(POLL_S)
    pytest.fail(f"{contract}; last seen: {str(last)[:500]}")


def err(r: httpx.Response):
    try:
        return (r.json().get("error") or {}).get("code")
    except (ValueError, AttributeError):
        return None


def rejects(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status and err(r) == code, f"{r.request.method} {r.request.url.path}: expected {status} {code}, got {r.status_code}: {r.text[:400]}"
    return r.json()["error"]


def ok(r: httpx.Response, status: int = 200):
    assert r.status_code == status, f"{r.request.method} {r.request.url.path}: expected {status}, got {r.status_code}: {r.text[:400]}"
    return r.json() if r.content else None


def api(base: str, email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=REQUEST_TIMEOUT_S)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session as {email}: {r.status_code} {r.text[:300]}"
    return c


def instance(env_name: str) -> str:
    url = os.environ.get(env_name)
    assert url, f"{env_name} must name the outage instance from the task spec"
    return url.rstrip("/")


def together(calls):
    barrier = threading.Barrier(len(calls))

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


def project(c: httpx.Client, prefix: str, targets=("de",), **extra) -> dict:
    slug = fresh(prefix)
    body = {"slug": slug, "name": f"Desk {slug}", "client": f"Client {slug}", "source_language": "en", "target_languages": list(targets), "repository": f"ivt-owner/{slug}"}
    body.update(extra)
    return ok(c.post("/api/projects", json=body), 201)


def keys(c, slug, branch="main", lang=None):
    q = f"?lang={lang}" if lang else ""
    return ok(c.get(f"/api/projects/{slug}/branches/{enc(branch)}/keys{q}"))["keys"]


def key_named(c, slug, name, branch="main"):
    return next((k for k in keys(c, slug, branch) if k["name"] == name), None)


def seg_id(c, slug, name, lang, branch="main") -> str:
    k = key_named(c, slug, name, branch)
    assert k, f"key {name} is listed on {branch}"
    return k["translations"][lang]["segment_id"]


def segment(c, sid):
    return ok(c.get(f"/api/segments/{sid}"))


def add_key(c, slug, name, source, branch="main") -> str:
    return ok(c.post(f"/api/projects/{slug}/branches/{enc(branch)}/keys", json={"name": name, "source": source}), 201)["id"]


def key_path(slug, branch, key_id):
    return f"/api/projects/{slug}/branches/{enc(branch)}/keys/{key_id}"


def set_value(c, sid, value):
    return ok(c.put(f"/api/segments/{sid}/value", json={"value": value}))


def score(c, sid, issues=()):
    return ok(c.post(f"/api/segments/{sid}/score", json={"issues": list(issues)}))


def approve(c, sid):
    return ok(c.post(f"/api/segments/{sid}/approve", json={}))


def make_approved(c, sid, value):
    set_value(c, sid, value)
    score(c, sid)
    s = approve(c, sid)
    assert s["status"] == "approved", s
    return s


def make_needs_review(c, sid, value):
    set_value(c, sid, value)
    s = score(c, sid, [MAJOR])
    assert s["status"] == "needs_review", f"one major issue on a short source scores below {DEFAULT_THRESHOLD}: {s}"
    return s


def branch(c, slug, name):
    return ok(c.post(f"/api/projects/{slug}/branches", json={"name": name}), 201)


def move(c, slug, name, to):
    return c.post(f"/api/projects/{slug}/branches/{enc(name)}/transitions", json={"to": to})


def preview(c, slug, name):
    return ok(c.get(f"/api/projects/{slug}/branches/{enc(name)}/merge-preview"))


def hold(c, slug, b, cid):
    return c.post(f"/api/projects/{slug}/branches/{enc(b)}/conflicts/{enc(cid)}/hold", json={})


def resolve(c, slug, b, cid, choice, value=None):
    body = {"choice": choice}
    if value is not None:
        body["value"] = value
    return c.put(f"/api/projects/{slug}/branches/{enc(b)}/conflicts/{enc(cid)}", json=body)


def merge(c, slug, b):
    return c.post(f"/api/projects/{slug}/branches/{enc(b)}/merge", json={})


def operations(c, slug):
    return ok(c.get(f"/api/projects/{slug}/operations"))["operations"]


def tm_entries(c, slug):
    return ok(c.get(f"/api/projects/{slug}/tm"))


def csv_bytes(rows, header=("source", "target", "target_language"), bom=False) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writerow(header)
    for row in rows:
        w.writerow(row)
    return (b"\xef\xbb\xbf" if bom else b"") + buf.getvalue().encode()


def import_tm(c, slug, data: bytes, fmt="csv", filename="memory.csv", ctype="text/csv"):
    return c.post(f"/api/projects/{slug}/tm/imports", files={"file": (filename, data, ctype)}, data={"format": fmt})


def upload_source(c, slug, b, data: bytes, filename="strings.json", ctype="application/json"):
    return c.post(f"/api/projects/{slug}/branches/{enc(b)}/source-files", files={"file": (filename, data, ctype)})


def invite(c, slug, prefix="rv"):
    name, email = person(prefix)
    body = ok(c.post(f"/api/projects/{slug}/reviewers", json={"name": name, "email": email}), 201)
    return body["id"], email, body["access_key"], name


def assign(c, slug, rid, lang="de", b="main"):
    return c.post(f"/api/projects/{slug}/assignments", json={"reviewer_id": rid, "branch": b, "language": lang})


def publish(c, slug, key, b="main"):
    return c.post(f"/api/projects/{slug}/publishes", json={"branch": b}, headers={"Idempotency-Key": key})


def new_key_header() -> str:
    return f"ivt-{tag('idem')}{tag('idem')}"


def wait_publish(c, slug, pid, states, seconds=PUBLISH_WAIT_S):
    return poll(lambda: ok(c.get(f"/api/projects/{slug}/publishes/{pid}")), lambda p: p.get("state") in states, seconds, f"publish {pid} reaches {states}")


def bundle(strings: dict) -> bytes:
    return (json.dumps(dict(sorted(strings.items())), ensure_ascii=False, indent=2) + "\n").encode()


def mqm(issues, source) -> int:
    words = len(source.split())
    penalty = sum(MQM_PENALTY[i["severity"]] for i in issues)
    raw = Decimal(MQM_FULL) - Decimal(MQM_FULL * penalty) / Decimal(max(words, MQM_MIN_WORDS))
    return max(0, int(raw.quantize(Decimal(1), rounding=ROUND_HALF_UP)))


def journal(wm, path, method=None):
    out = []
    for e in (wm.requests(path, method) if method else wm.requests(path)):
        req = e.get("request", e)
        body = req.get("body") or ""
        if not body and req.get("bodyAsBase64"):
            body = base64.b64decode(req["bodyAsBase64"]).decode("utf-8", "replace")
        url = req.get("url") or req.get("absoluteUrl") or ""
        query = parse_qs(urlparse(url).query) if url else {k: [v] for k, v in (req.get("query") or {}).items()}
        out.append({"url": url or req.get("path", ""), "method": req.get("method"), "body": body, "query": query})
    return out


def rows_mentioning(pg, needle: str) -> int:
    total = 0
    for t in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in t.split("."))
        total += int(pg.rows(f"SELECT count(*) AS n FROM {ident} AS x WHERE x::text LIKE '%{needle}%'")[0]["n"])
    return total


def audit_for(c, slug, *aliases):
    needles = (slug, *aliases)
    return [e for e in ok(c.get("/api/audit"))["entries"] if any(n in json.dumps(e, ensure_ascii=False) for n in needles)]


def svix_app(svix, project_id):
    return [a for a in svix.applications() if a.get("uid") == f"idk-{project_id}"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_copy(**env):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env={**os.environ, "APP_PUBLIC_PORT": str(port), **env}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_bytes()[-3000:].decode("utf-8", "replace")

    try:
        yield f"http://127.0.0.1:{port}", proc, tail
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=COPY_STOP_S)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)


def wait_health(base, proc, tail, seconds=HEALTH_WITHIN_S):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"the copy exited with {proc.returncode}; log tail:\n{tail()}")
        with contextlib.suppress(httpx.HTTPError):
            last = httpx.get(base + "/api/health", timeout=REQUEST_TIMEOUT_S)
            if last.status_code == 200:
                return last
        _TICK.wait(POLL_S)
    pytest.fail(f"GET /api/health answered 200 within {seconds}s; last {last and last.text}; log tail:\n{tail()}")


@contextlib.contextmanager
def browse(browser, base, path, who: httpx.Client | None = None, size=(1280, 800), reduced="no-preference", keep_notice=False):
    cm = open_app(browser, base + ("/sign-in" if who is not None else path), reduced_motion=reduced)
    page = cm.__enter__() if hasattr(cm, "__enter__") else next(cm)
    try:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if who is not None:
            page.context.add_cookies([{"name": "desk_session", "value": who.cookies.get("desk_session"), "url": base}])
            page.goto(base + path)
        if not keep_notice:
            dismiss_notice(page)
        yield page
    finally:
        if hasattr(cm, "__exit__"):
            cm.__exit__(None, None, None)
        else:
            cm.close()


def dismiss_notice(page):
    got = page.get_by_role("region", name="Cookie and data notice").get_by_role("button", name="Got it")
    deadline = time.monotonic() + NOTICE_WAIT_S
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            if got.count() and got.first.is_visible():
                got.first.click()
                return
        advance(page, STEP_MS)


def show(page, target, what, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            if target.count() and target.first.is_visible():
                return target.first
        advance(page, STEP_MS)
    pytest.fail(f"{what}: never became visible")


def gone(page, target, what, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            if target.count() == 0 or not target.first.is_visible():
                return
        advance(page, STEP_MS)
    pytest.fail(f"{what}: still visible")


def reads(page, target, accept, what, seconds=UI_WAIT_S) -> str:
    if isinstance(accept, str):
        needle = accept
        accept = lambda t: needle in t
    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            if target.count():
                last = target.first.inner_text(timeout=1000)
                if accept(last):
                    return last
        advance(page, STEP_MS)
    pytest.fail(f"{what}; last text: {last[:600]!r}")


def at_path(page, path, what, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if urlparse(page.url).path == path:
            return
        advance(page, STEP_MS)
    pytest.fail(f"{what}: expected path {path}, at {page.url}")


def updates(page):
    return page.get_by_role("status", name="Desk updates")


def problems(page):
    return page.get_by_role("alert", name="Desk problems")


def has_figure(text: str, caption: str, value) -> bool:
    v, cap = re.escape(str(value)), re.escape(caption)
    return re.search(rf"(?<![\d#]){v}\s*{cap}|{cap}\s*{v}(?![\d])", text) is not None


def box(locator):
    b = locator.bounding_box()
    assert b, f"{locator} has a layout box"
    return b


def columns(locators) -> int:
    return len({round(box(l)["x"]) for l in locators})


def sign_in_ui(page, email, password):
    show(page, page.get_by_role("textbox", name="Email"), "sign-in form")
    fill(page.get_by_role("textbox", name="Email"), email)
    pw = page.get_by_label("Password", exact=True)
    fill(pw, password)
    pw.press("Enter")


def inside(dialog) -> bool:
    return dialog.evaluate("d => d.contains(document.activeElement)")


def query_branch(page):
    return parse_qs(urlparse(page.url).query).get("branch", [None])[0]


def tab_texts(tablist):
    tabs = tablist.get_by_role("tab")
    return [((tabs.nth(i).get_attribute("aria-label") or "") + " " + tabs.nth(i).inner_text()).strip() for i in range(tabs.count())]


MOTION_JS = r"""
() => {
  if (window.__ivtMotion) { window.__ivtMotion.length = 0; return; }
  const log = window.__ivtMotion = [];
  const skip = ['offset', 'easing', 'composite', 'computedOffset'];
  const timing = a => { try { const t = a.effect.getComputedTiming(); return [Number(t.duration) || 0, Number(t.delay) || 0]; } catch (e) { return [0, 0]; } };
  const find = (target, pseudo, test) => document.getAnimations().find(a => a.effect && a.effect.target === target && (a.effect.pseudoElement || '') === (pseudo || '') && test(a));
  const push = (props, a) => { const [d, delay] = a ? timing(a) : [0, 0]; for (const p of new Set(props)) log.push({prop: String(p).toLowerCase().replace(/-/g, ''), duration: d, delay}); };
  document.addEventListener('transitionrun', e => push([e.propertyName], find(e.target, e.pseudoElement, x => x.transitionProperty === e.propertyName)), true);
  document.addEventListener('animationstart', e => {
    const a = find(e.target, e.pseudoElement, x => x.animationName === e.animationName);
    push(a ? a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !skip.includes(p)) : ['unknown'], a);
  }, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const a = original.call(this, frames, options);
    push(a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !skip.includes(p)), a);
    return a;
  };
}
"""
ANIMS_JS = r"""
el => el.getAnimations({subtree: true}).map(a => { const t = a.effect.getComputedTiming(); return {duration: Number(t.duration) || 0, iterations: t.iterations === Infinity ? -1 : t.iterations, state: a.playState}; })
"""
LOOPS_JS = r"""
() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity && a.playState !== 'finished').length
"""
GEOMETRY = ("transform", "translate", "left", "width", "inset", "scale", "right", "clip")


def motion_log(page):
    return page.evaluate("() => window.__ivtMotion ? window.__ivtMotion.slice() : []")


def ms(value: str) -> list[float]:
    out = []
    for part in value.split(","):
        part = part.strip()
        out.append(float(part[:-2]) if part.endswith("ms") else float(part[:-1]) * 1000 if part.endswith("s") else 0.0)
    return out


def test_seed_exact_first_boot(app_url, svix):
    c = api(app_url)
    me = ok(c.get("/api/me"))
    user = me.get("user", me)
    assert (user["email"], user["role"], user["name"]) == (OWNER_EMAIL, "owner", OWNER_NAME)

    p = ok(c.get(f"/api/projects/{SEED_SLUG}"))
    assert (p["name"], p["client"], p["source_language"], p["repository"], p["mqm_threshold"]) == ("Larkspur Rider", "Larkspur Cycles", "en", "larkspur-cycles/rider-app", 90)
    assert sorted(p["target_languages"]) == ["de", "fr", "ja"]
    assert p["ai_routes"] == {"de": "lexa-general", "fr": "lexa-general", "ja": "lexa-formal"}
    assert p["tm_entries"] == 6 and p["last_publish"] is None
    branches = ok(c.get(f"/api/projects/{SEED_SLUG}/branches"))["branches"]
    assert sorted((b["name"], b["state"]) for b in branches) == [(SEED_BRANCH, "open"), ("main", "open")]

    main = {k["name"]: k for k in keys(c, SEED_SLUG)}
    assert len(main) == 40 and [(n, main[n]["source"]) for n, _ in SEED_KEYS] == SEED_KEYS
    for i, (name, _) in enumerate(SEED_KEYS):
        tr = main[name]["translations"]
        for lang, values in (("de", SEED_DE), ("fr", SEED_FR), ("ja", SEED_JA)):
            got = (tr[lang]["value"], tr[lang]["status"], tr[lang]["score"])
            if i < len(values):
                assert got == (values[i], "approved", 100), (name, lang, got)
            elif lang == "ja" and i == 5:
                assert got == ("ようこそ、{name}。", "needs_review", 50), got
            elif lang == "ja" and i == 6:
                assert got == ("今週は{distance}km走りました。", "needs_review", 80), got
            else:
                assert got == (None, "untranslated", None), (name, lang, got)
    greet = segment(c, main["home.greeting"]["translations"]["ja"]["segment_id"])
    assert greet["origin"] == "seed" and [(x["category"], x["severity"], x["note"]) for x in greet["issues"]] == [("accuracy", "major", 'Drops "back" from the greeting.')]
    weekly = segment(c, main["home.weekly_distance"]["translations"]["ja"]["segment_id"])
    assert sorted((x["category"], x["severity"], x["note"]) for x in weekly["issues"]) == [("fluency", "minor", "Unit reads awkwardly."), ("style", "minor", "Casual register on a formal route.")]
    assert segment(c, main["app.title"]["translations"]["de"]["segment_id"])["origin"] == "seed"

    hist32 = ok(c.get(f"/api/projects/{SEED_SLUG}/keys/{main['checkout.summary.title']['id']}/history"))["revisions"]
    assert [r["field"] for r in hist32] == ["created", "source"] and (hist32[1]["from"], hist32[1]["to"]) == ("Order summary", "Basket summary")
    assert [r["field"] for r in ok(c.get(f"/api/projects/{SEED_SLUG}/keys/{main['app.title']['id']}/history"))["revisions"]] == ["created"]

    tm = tm_entries(c, SEED_SLUG)
    assert tm["total"] == 6 and {(e["source"], e["target_language"], e["target"]) for e in tm["entries"]} == SEED_TM
    assert all(e.get("import_id") is None for e in tm["entries"])

    feat = {k["name"]: k for k in keys(c, SEED_SLUG, SEED_BRANCH)}
    assert len(feat) == 42
    assert feat["checkout.cta.pay"]["source"] == "Pay and finish" and feat["checkout.summary.title"]["source"] == "Your order"
    for name, src in (("checkout.saved_card", "Pay with a saved card"), ("checkout.promo.label", "Promo code")):
        assert feat[name]["source"] == src and all(t["status"] == "untranslated" for t in feat[name]["translations"].values())
    pv = preview(c, SEED_SLUG, SEED_BRANCH)
    assert (pv["new_keys"], pv["edited_keys"], pv["deleted_keys"], pv["below_threshold"]) == (2, 1, 0, 2)
    assert len(pv["conflicts"]) == 1
    conflict = pv["conflicts"][0]
    assert conflict["id"] == f"{main['checkout.summary.title']['id']}:source" and conflict["resolution"] is None
    assert (conflict["base"], conflict["main"], conflict["branch"]) == ("Order summary", "Basket summary", "Your order")
    pm = preview(c, SEED_SLUG, "main")
    assert (pm["keys"], pm["needs_review"], pm["below_threshold"], pm["new_keys"], pm["edited_keys"], pm["deleted_keys"], pm["conflicts"]) == (40, 2, 2, 0, 0, 0, [])

    for path, field in (("reviewers", "reviewers"), ("tokens", "tokens"), ("tm/imports", "imports"), ("source-files", "files"), ("operations", "operations"), ("publishes", "publishes"), ("events", "events"), ("assignments", "assignments")):
        assert ok(c.get(f"/api/projects/{SEED_SLUG}/{path}"))[field] == [], path
    rejects(c.get(f"/api/projects/{SEED_SLUG}/webhook"), 404, "not_found")

    seeded = [e for e in ok(c.get("/api/audit"))["entries"] if e["action"] == "workspace.seeded"]
    assert len(seeded) == 1 and seeded[0]["actor"] == "system", f"exactly one seed entry however many instances booted: {seeded}"
    others = [x["slug"] for x in ok(c.get("/api/projects"))["projects"] if not x["slug"].startswith("ivt-")]
    assert others == [SEED_SLUG], f"nothing but the seed is pre-loaded: {others}"
    assert S3().keys(f"projects/{p['id']}/") == []
    assert svix_app(svix, p["id"]) == []


def test_session_and_scopes(app_url):
    wrong = httpx.post(app_url + "/api/session", json={"email": OWNER_EMAIL, "password": "not-the-password"}, timeout=REQUEST_TIMEOUT_S)
    rejects(wrong, 401, "invalid_credentials")
    assert wrong.cookies.get("desk_session") in (None, "")

    good = httpx.post(app_url + "/api/session", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=REQUEST_TIMEOUT_S)
    assert good.status_code == 200 and good.json()["user"]["role"] == "owner" and good.json()["user"]["email"] == OWNER_EMAIL
    cookie = next((v for _, v in good.headers.multi_items() if v.startswith("desk_session=")), None)
    assert cookie, good.headers
    low = cookie.lower()
    assert "HttpOnly".lower() in low and "SameSite=Lax".lower() in low, cookie

    c = api(app_url)
    a = project(c, "scopa")
    b = project(c, "scopb")
    rid, email, key, _ = invite(c, a["slug"])
    rv = api(app_url, email, key)
    anon = httpx.Client(base_url=app_url, timeout=REQUEST_TIMEOUT_S)

    rejects(anon.get("/api/me"), 401, "unauthenticated")
    big = b'{"name":"x"}' + b" " * (JSON_LIMIT + 1 - len(b'{"name":"x"}'))
    rejects(anon.post(f"/api/projects/{a['slug']}/branches", content=big, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    rejects(anon.post(f"/api/projects/{a['slug']}/branches", content=b"name", headers={"Content-Type": "text/plain"}), 401, "unauthenticated")

    assert ok(rv.get(f"/api/projects/{a['slug']}"))["slug"] == a["slug"]
    rejects(rv.get(f"/api/projects/{b['slug']}"), 404, "not_found")
    rejects(rv.get(f"/api/projects/{b['slug']}/branches"), 404, "not_found")
    rejects(rv.get(f"/api/projects/{a['slug']}/branches"), 403, "forbidden")
    rejects(rv.post(f"/api/projects/{a['slug']}/branches", content=b"name", headers={"Content-Type": "text/plain"}), 403, "forbidden")
    rejects(rv.get("/api/workspace/stats"), 403, "forbidden")
    rejects(rv.get("/api/audit"), 403, "forbidden")
    rejects(c.post(f"/api/projects/{a['slug']}/branches", content=b"name", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    bad = rejects(c.post(f"/api/projects/{a['slug']}/branches", json={"name": "Not A Branch"}), 422, "validation_failed")
    assert "name" in (c.post(f"/api/projects/{a['slug']}/branches", json={"name": "Not A Branch"}).json()["error"].get("fields") or {}), bad
    rejects(c.post("/api/projects", json={"slug": a["slug"], "name": "", "client": "", "source_language": "en", "target_languages": ["de"], "repository": "x/y"}), 409, "slug_taken")
    assert branch_names(c, a["slug"]) == ["main"], "no rejected call created a branch"

    ok(c.delete("/api/session"), 204)
    rejects(c.get("/api/me"), 401, "unauthenticated")


def branch_names(c, slug):
    return sorted(b["name"] for b in ok(c.get(f"/api/projects/{slug}/branches"))["branches"])


def test_wf_first_run_wrong_password(browser, app_url):
    with browse(browser, app_url, "/audit") as page:
        at_path(page, "/sign-in", "an anonymous visit to /audit goes to sign-in")
        sign_in_ui(page, OWNER_EMAIL, "not-the-password")
        reads(page, problems(page), "That email and password don't match.", "the 401 sign-in copy")
        sign_in_ui(page, OWNER_EMAIL, OWNER_PASSWORD)
        at_path(page, "/audit", "after sign-in the owner returns to the page first asked for")
        me = page.request.get(app_url + "/api/me")
        assert me.status == 200 and me.json()["user"]["role"] == "owner" if "user" in me.json() else me.json()["role"] == "owner"
        cookies = [k for k in page.context.cookies() if k["name"] == "desk_session"]
        assert cookies and cookies[0]["httpOnly"] is True


BAND = (("Exact matches reused", "exact_matches_reused"), ("Conflicts open", "conflicts_open"), ("Below MQM threshold", "below_threshold"), ("Publishes confirmed", "publishes_confirmed"))


def band_matches_api(page, c, what):
    band = page.get_by_role("region", name="Workspace analytics")
    show(page, band, "region Workspace analytics")
    deadline = time.monotonic() + UI_WAIT_S
    text, before, after = "", {}, {}
    while time.monotonic() < deadline:
        before = ok(c.get("/api/workspace/stats"))
        text = band.inner_text()
        after = ok(c.get("/api/workspace/stats"))
        if all(has_figure(text, cap, before[k]) or has_figure(text, cap, after[k]) for cap, k in BAND):
            return text
        advance(page, STEP_MS)
    pytest.fail(f"{what}: analytics band {text!r} matches GET /api/workspace/stats {after}")


def test_wf_first_run_happy(browser, app_url):
    c = api(app_url)
    with browse(browser, app_url, "/") as page:
        click(page.get_by_role("link", name="Open the demo desk").first)
        sign_in_ui(page, OWNER_EMAIL, OWNER_PASSWORD)
        at_path(page, "/desk", "the owner lands on the dashboard")
        show(page, page.get_by_role("heading", name="Your desk", exact=True), "heading Your desk")
        strip = page.get_by_role("region", name="Client apps")
        text = reads(page, strip, "Client apps on this desk:", "the wordmark strip line")
        assert "Larkspur Cycles" in text
        band = band_matches_api(page, c, "first load")
        for cap, _ in BAND:
            assert cap in band
        show(page, page.get_by_role("region", name="Workspace analytics").get_by_role("link", name="Open audit log"), "link Open audit log")
        click(page.get_by_role("link", name=f"Open {SEED_NAME}"))
        tablist = show(page, page.get_by_role("tablist", name="Branches"), "branch rail")
        reads(page, tablist, lambda t: SEED_BRANCH in t, "the seeded branch tab")
        names = tab_texts(tablist)
        assert len(names) == 2 and "main" in names[0] and SEED_BRANCH in names[1], names

        p = project(c, "dash")
        s = p["slug"]
        kid = add_key(c, s, "ivt.dash", "Dash one")
        branch(c, s, "dash/one")
        ok(c.patch(key_path(s, "dash/one", kid), json={"source": "Dash branch"}))
        ok(c.patch(key_path(s, "main", kid), json={"source": "Dash main"}))
        page.goto(app_url + "/desk")
        band_matches_api(page, c, "reload after a new conflict")
        show(page, page.get_by_role("link", name=f"Open {p['name']}"), "the new project's card")
        reads(page, page.get_by_role("region", name="Client apps"), p["client"], "the new client's wordmark")


def test_not_found_and_empty_copy(browser, app_url):
    c = api(app_url)
    a = project(c, "nfa")
    b = project(c, "nfb")
    _, email, key, _ = invite(c, a["slug"])
    rv = api(app_url, email, key)
    missing = fresh("gone")
    with browse(browser, app_url, "/desk", who=c) as page:
        r = page.goto(f"{app_url}/projects/{missing}")
        assert r and r.status == 404
        show(page, page.get_by_role("heading", name="We couldn't find that project", exact=True), "project not-found heading")
        show(page, page.get_by_text("It may have been erased, or the link is wrong.", exact=True), "project not-found sentence")
        show(page, page.get_by_role("link", name="Back to your desk", exact=True), "owner back link")
        r = page.goto(f"{app_url}/{missing}-page")
        assert r and r.status == 404
        show(page, page.get_by_role("heading", name="We couldn't find that page", exact=True), "page not-found heading")
        show(page, page.get_by_role("link", name="Back to your desk", exact=True), "owner back link on page not-found")
        page.goto(f"{app_url}/projects/{a['slug']}/tm")
        show(page, page.get_by_role("heading", name="No translation memory yet", exact=True), "empty TM heading")
        show(page, page.get_by_text("Import a TMX file or a spreadsheet to start reusing exact matches.", exact=True), "empty TM sentence")
        show(page, page.get_by_role("button", name="Import translation memory", exact=True), "empty TM button")
    with browse(browser, app_url, "/review", who=rv) as page:
        show(page, page.get_by_role("heading", name="Nothing to review right now", exact=True), "empty queue heading")
        show(page, page.get_by_text("When the engineer assigns segments to you, they'll show up here.", exact=True), "reviewer empty sentence")
        show(page, page.get_by_role("button", name="Refresh queue"), "Refresh queue")
        r = page.goto(f"{app_url}/projects/{b['slug']}")
        assert r and r.status == 404
        show(page, page.get_by_role("heading", name="We couldn't find that project", exact=True), "out-of-scope heading")
        show(page, page.get_by_role("link", name="Back to your review queue", exact=True), "reviewer back link")


def test_tm_import_tmx_fills_main(app_url):
    c = api(app_url)
    p = project(c, "tmx", targets=("de", "fr"))
    s = p["slug"]
    t = tag("tmx")
    add_key(c, s, "ivt.greet", f"Good morning {t}, {{user}}!")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tmx version="1.4">',
        '<header srclang="en-GB" datatype="plaintext" segtype="sentence" adminlang="en" o-tmf="ivt" creationtool="ivt" creationtoolversion="1"/>',
        "<body>",
        "<tu>",
        f'<tuv xml:lang="en-GB"><seg>Good <hi>MORNING</hi> {t},   %s!</seg></tuv>',
        f'<tuv xml:lang="de-DE"><seg>Guten Morgen {t}, %s!</seg></tuv>',
        f'<tuv lang="fr"><seg>Bonjour {t}, %s !</seg></tuv>',
        '<tuv xml:lang="es"><seg>Buenos dias, %s!</seg></tuv>',
        "</tu>",
        "<tu>",
        f'<tuv xml:lang="en"><seg>Bike {t} parked</seg></tuv>',
        f'<tuv xml:lang="de"><seg>Rad {t} geparkt</seg></tuv>',
        "</tu>",
        "</body>",
        "</tmx>",
    ]
    data = ("\n".join(lines) + "\n").encode()
    r = ok(import_tm(c, s, data, "tmx", "legacy.tmx", "application/xml"), 201)
    assert (r["added"], r["duplicates"], r["applied"]) == (3, 0, 2), r
    assert [(x["line"], x["reason"]) for x in r["rows"]] == [(5, "unknown_language"), (11, "no_matching_key")]
    assert (r["filename"], r["format"], r["size"], r["sha256"]) == ("legacy.tmx", "tmx", len(data), hashlib.sha256(data).hexdigest())
    assert r["object_key"] == f"projects/{p['id']}/imports/{r['import_id']}"
    de = segment(c, seg_id(c, s, "ivt.greet", "de"))
    fr = segment(c, seg_id(c, s, "ivt.greet", "fr"))
    assert (de["value"], de["status"], de["origin"], de["score"]) == (f"Guten Morgen {t}, {{user}}!", "drafted", "tm", None)
    assert (fr["value"], fr["status"], fr["origin"]) == (f"Bonjour {t}, {{user}} !", "drafted", "tm")
    assert tm_entries(c, s)["total"] == 3


def test_tm_import_csv_and_limits(app_url):
    c = api(app_url)
    p = project(c, "csvl", targets=("de", "fr"))
    s = p["slug"]
    t = tag("csvl")
    add_key(c, s, "ivt.pad", f"Pad {t}")
    data = csv_bytes([("fr", "a note", f"Coussin {t}", f"pad {t}")], header=("target_language", "note", "target", "source"), bom=True)
    r = ok(import_tm(c, s, data), 201)
    assert (r["added"], r["applied"], r["rows"]) == (1, 1, [])
    assert segment(c, seg_id(c, s, "ivt.pad", "fr"))["value"] == f"Coussin {t}"

    head = f"source,target,target_language,note\nPad {t},Polster {t},de,".encode()
    exact = head + b"x" * (FILE_LIMIT - len(head) - 1) + b"\n"
    assert len(exact) == FILE_LIMIT
    r = ok(import_tm(c, s, exact), 201)
    assert r["size"] == FILE_LIMIT and r["added"] == 1
    before = (tm_entries(c, s)["total"], len(ok(c.get(f"/api/projects/{s}/tm/imports"))["imports"]))
    over = head + b"x" * (FILE_LIMIT - len(head)) + b"\n"
    assert len(over) == FILE_LIMIT + 1
    rejects(import_tm(c, s, over), 413, "payload_too_large")
    rejects(import_tm(c, s, csv_bytes([("a", "b", "de")], header=("source", "translation", "lang"))), 422, "validation_failed")
    rejects(import_tm(c, s, b"<tmx><body><tu>", "tmx", "broken.tmx", "application/xml"), 422, "validation_failed")
    after = (tm_entries(c, s)["total"], len(ok(c.get(f"/api/projects/{s}/tm/imports"))["imports"]))
    assert after == before, "rejected imports added nothing"


NORMALISATION_CASES = {
    "brief_total": (" TOTAL: {{sum}} ", "Summe: {{sum}}", "Total:   {amount}", "Summe: {amount}"),
    "brief_positional": ("Hi %1$s, you have %2$d items", "%2$d Artikel für %1$s", "Hi {name}, you have {count} items", "{count} Artikel für {name}"),
    "unicode_nfc": ("CAFE\u0301 open", "Café geöffnet", "Café open", "Café geöffnet"),
    "nbsp_and_tabs": ("Sign\u00a0\tout\n", "Abmelden", "Sign out", "Abmelden"),
    "printf_styles": ("%@ of %d done", "%@ von %d fertig", "{done} of {total} done", "{done} von {total} fertig"),
    "different_text": ("Sign out now", "Jetzt abmelden", "Sign out", None),
}


@pytest.mark.parametrize("case", list(NORMALISATION_CASES), ids=list(NORMALISATION_CASES))
def test_exact_match_everywhere(app_url, case):
    tm_source, tm_target, key_source, expected = NORMALISATION_CASES[case]
    c = api(app_url)
    s = project(c, "norm")["slug"]
    branch(c, s, "norm/draft")
    add_key(c, s, "ivt.a", key_source)
    add_key(c, s, "ivt.b", key_source, "norm/draft")
    r = ok(import_tm(c, s, csv_bytes([(tm_source, tm_target, "de")])), 201)
    a = segment(c, seg_id(c, s, "ivt.a", "de"))
    match = ok(c.post(f"/api/projects/{s}/tm/match", json={"source": key_source, "language": "de"}))["match"]
    add_key(c, s, "ivt.c", key_source)
    created = segment(c, seg_id(c, s, "ivt.c", "de"))
    drafted = ok(c.post(f"/api/projects/{s}/branches/{enc('norm/draft')}/drafts", json={"language": "de"}))
    b = segment(c, seg_id(c, s, "ivt.b", "de", "norm/draft"))
    if expected is None:
        assert r["applied"] == 0 and a["status"] == "untranslated" and match is None and created["status"] == "untranslated"
        assert drafted["tm_reused"] == 0 and b["origin"] != "tm"
    else:
        assert r["applied"] == 1 and (a["value"], a["origin"], a["status"]) == (expected, "tm", "drafted")
        assert match and match["reused_value"] == expected and match["target"] == tm_target
        assert (created["value"], created["origin"], created["status"]) == (expected, "tm", "drafted")
        assert drafted["tm_reused"] == 1 and (b["value"], b["origin"], b["status"], b["score"]) == (expected, "tm", "drafted", None)


def report_csv(t: str, m: str) -> bytes:
    rows = [
        ("de", "", f"Öffnen {t}", f"open {t}  panel"),
        ("de", "", f"öffnen {t}", f"OPEN {t} PANEL"),
        ("de", "", "x", ""),
        ("de", "", "", f"Close {t}"),
        ("es", "", "Cerrar", f"Close {t}"),
        ("de", "", f"Aufmachen {t}", f"Open {t} panel"),
        ("de", "", f"Zeile {m}", f"Line one {t}\nline two"),
        ("fr", "", f"Ouvrir {t}", f"Open {t} panel"),
        ("es", "", "", ""),
    ]
    return csv_bytes(rows, header=("target_language", "note", "target", "source"), bom=True)


REPORT_FIRST = [(4, "missing_source"), (5, "missing_target"), (6, "unknown_language"), (7, "conflicting_target"), (8, "no_matching_key"), (11, "missing_source")]
REPORT_AGAIN = [(4, "missing_source"), (5, "missing_target"), (6, "unknown_language"), (7, "conflicting_target"), (11, "missing_source")]


def test_tm_import_rows_and_reimport(app_url):
    c = api(app_url)
    s = project(c, "rows", targets=("de", "fr"))["slug"]
    t, m = tag("rows"), tag("mark")
    add_key(c, s, "ivt.open", f"Open {t} panel")
    data = report_csv(t, m)
    first = ok(import_tm(c, s, data), 201)
    assert [(x["line"], x["reason"]) for x in first["rows"]] == REPORT_FIRST
    assert (first["added"], first["duplicates"], first["applied"]) == (3, 1, 2)
    entries = tm_entries(c, s)
    assert entries["total"] == 3
    de = [e for e in entries["entries"] if e["target_language"] == "de" and t in e["source"] and "panel" in e["source"].lower()]
    assert [e["target"] for e in de] == [f"Öffnen {t}"], "the first row's target is kept; duplicates and conflicts add nothing"
    pg = Postgres()
    stored = rows_mentioning(pg, m)
    assert stored >= 1
    again = ok(import_tm(c, s, data), 201)
    assert (again["added"], again["applied"], again["duplicates"]) == (0, 0, first["added"] + first["duplicates"])
    assert [(x["line"], x["reason"]) for x in again["rows"]] == REPORT_AGAIN
    assert tm_entries(c, s)["total"] == 3
    assert rows_mentioning(pg, m) == stored, "a re-import stored no new TM rows"


def test_tm_import_original_bytes(app_url):
    c = api(app_url)
    p = project(c, "orig")
    s = p["slug"]
    t = tag("orig")
    files = [
        ("legacy.csv", "csv", "text/csv", b"\xef\xbb\xbfsource,target,target_language\r\n  Hello " + t.encode() + b"  ,Hallo,de\r\n\r\n"),
        ("legacy.tmx", "tmx", "application/xml", f'<?xml version="1.0"?>\r\n<tmx version="1.4"><header srclang="en"/><body>\r\n<tu><tuv xml:lang="en"><seg>Hi {t}</seg></tuv><tuv xml:lang="de"><seg>Hallo {t}</seg></tuv></tu>\r\n</body></tmx>  '.encode()),
    ]
    bucket = S3()
    for filename, fmt, ctype, data in files:
        r = ok(import_tm(c, s, data, fmt, filename, ctype), 201)
        assert (r["size"], r["sha256"]) == (len(data), hashlib.sha256(data).hexdigest())
        assert r["object_key"] == f"projects/{p['id']}/imports/{r['import_id']}"
        assert bucket.get(r["object_key"]) == data, f"{filename} stored byte for byte"
        down = c.get(f"/api/projects/{s}/tm/imports/{r['import_id']}/original")
        assert down.status_code == 200 and down.content == data, filename
        listed = [x for x in ok(c.get(f"/api/projects/{s}/tm/imports"))["imports"] if x["import_id"] == r["import_id"]]
        assert listed and listed[0]["sha256"] == r["sha256"] and listed[0]["filename"] == filename


def test_source_upload_parses_and_rejects(app_url):
    c = api(app_url)
    s = project(c, "srcu")["slug"]
    old_title = "Old title"
    add_key(c, s, "ivt.app.title", old_title)
    add_key(c, s, "ivt.same", "Same")
    add_key(c, s, "ivt.keep", "Keep me")
    b = "src/one"
    branch(c, s, b)
    data = '\ufeff{"ivt": {"app": {"title": "  New title  "}, "nav": {"home": "Home \\n"}, "same": " Same\\t"}, "ivt.flat": "Flat"}'.encode()
    r = ok(upload_source(c, s, b, data), 201)
    assert (r["keys_added"], r["keys_changed"], r["keys_unchanged"]) == (2, 1, 1), r
    got = {k["name"]: k["source"] for k in keys(c, s, b)}
    assert got == {"ivt.app.title": "New title", "ivt.nav.home": "Home", "ivt.same": "Same", "ivt.flat": "Flat", "ivt.keep": "Keep me"}
    assert key_named(c, s, "ivt.app.title")["source"] == old_title, "main is untouched"
    for bad in (b'{"a": ["x"]}', b'{"a": 1}', b'{"a": true}', b'{"a": null}', b'{"a": "x", "a": "y"}', b'{"has space": "x"}', b'["x"]', b'{"a": '):
        e = rejects(upload_source(c, s, b, bad), 422, "validation_failed")
        assert "file" in (upload_source(c, s, b, bad).json()["error"].get("fields") or {}), e
    assert {k["name"]: k["source"] for k in keys(c, s, b)} == got
    ok(move(c, s, b, "in_review"))
    rejects(upload_source(c, s, b, b'{"ivt.extra": "x"}'), 409, "branch_not_open")
    ok(move(c, s, b, "abandoned"))
    rejects(upload_source(c, s, b, b'{"ivt.extra": "x"}'), 409, "branch_closed")
    assert {k["name"]: k["source"] for k in keys(c, s, b)} == got


def test_wf_source_upload_happy(browser, app_url):
    c = api(app_url)
    s = project(c, "srcw")["slug"]
    branch(c, s, "src/ui")
    data = b'{\n  "ivt": { "ui": { "one": "  First  ", "two": "Second" } }\n}\n'
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("region", name="Workflows").get_by_role("button", name="Upload source file"), "Upload source file"))
        dlg = show(page, page.get_by_role("dialog", name="Upload source file"), "dialog Upload source file")
        select(dlg.get_by_role("combobox", name="Branch"), "src/ui")
        page.get_by_label("Source file").set_input_files(files=[{"name": "ui.json", "mimeType": "application/json", "buffer": data}])
        click(dlg.get_by_role("button", name="Upload"))
        reads(page, updates(page), "Stored ui.json as submitted: 2 keys added, 0 changed, 0 unchanged.", "upload success copy")
        assert {k["name"]: k["source"] for k in keys(c, s, "src/ui")} == {"ivt.ui.one": "First", "ivt.ui.two": "Second"}
        page.goto(f"{app_url}/projects/{s}/settings")
        link = show(page, page.get_by_role("link", name="Download original"), "Download original")
        got = page.request.get(urljoin(page.url, link.get_attribute("href")))
        assert got.status == 200 and got.body() == data


def test_wf_source_upload_invalid(browser, app_url):
    c = api(app_url)
    s = project(c, "srcx")["slug"]
    branch(c, s, "src/bad")
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("region", name="Workflows").get_by_role("button", name="Upload source file"), "Upload source file"))
        dlg = show(page, page.get_by_role("dialog", name="Upload source file"), "dialog Upload source file")
        select(dlg.get_by_role("combobox", name="Branch"), "src/bad")
        page.get_by_label("Source file").set_input_files(files=[{"name": "bad.json", "mimeType": "application/json", "buffer": b'{"ivt.count": 3}'}])
        click(dlg.get_by_role("button", name="Upload"))
        reads(page, problems(page), "The file must be a JSON object whose values are all strings.", "bad JSON copy")
        assert dlg.is_visible(), "a rejected save keeps the dialog open"
        assert keys(c, s, "src/bad") == []


def multipart_without_type(data: bytes, filename: str) -> tuple[bytes, str]:
    boundary = "ivtboundary7f3a"
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n\r\n'.encode()
    return head + data + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def test_source_original_download(app_url):
    c = api(app_url)
    p = project(c, "srcd")
    s = p["slug"]
    bname = "src/dl"
    fname = "strings-en.json"
    part_type = "application/vnd.ivt+json"
    trimmed = "padded"
    branch(c, s, bname)
    data = b'\xef\xbb\xbf{\r\n  "ivt.dl.one":   "  padded  ",\r\n  "ivt.dl.two": "x"\r\n}   '
    r = ok(upload_source(c, s, bname, data, fname, part_type), 201)
    assert (r["filename"], r["size"], r["sha256"]) == (fname, len(data), hashlib.sha256(data).hexdigest())
    assert r["object_key"] == f"projects/{p['id']}/source-files/{r['file_id']}"
    assert S3().get(r["object_key"]) == data
    assert key_named(c, s, "ivt.dl.one", bname)["source"] == trimmed, "the working copy is trimmed"
    down = c.get(f"/api/projects/{s}/source-files/{r['file_id']}/original")
    assert down.status_code == 200 and down.content == data
    assert down.headers["content-type"].lower() == part_type
    assert down.headers["content-disposition"] == f'attachment; filename="{fname}"'
    listed = [f for f in ok(c.get(f"/api/projects/{s}/source-files"))["files"] if f["file_id"] == r["file_id"]]
    assert listed and listed[0]["branch"] == bname and listed[0]["content_type"] == part_type

    body, ctype = multipart_without_type(b'{"ivt.dl.three": "Three"}', "bare.json")
    bare = ok(c.post(f"/api/projects/{s}/branches/{enc(bname)}/source-files", content=body, headers={"Content-Type": ctype}), 201)
    down = c.get(f"/api/projects/{s}/source-files/{bare['file_id']}/original")
    assert down.headers["content-type"].lower() == "application/octet-stream" and down.content == b'{"ivt.dl.three": "Three"}'


def test_source_edits_history_and_removed_placeholder(browser, app_url):
    c = api(app_url)
    s = project(c, "hist", targets=("de", "fr"))["slug"]
    kid = add_key(c, s, "ivt.hist", "Ride now")
    make_approved(c, seg_id(c, s, "ivt.hist", "de"), "Jetzt fahren")
    make_needs_review(c, seg_id(c, s, "ivt.hist", "fr"), "Rouler")
    b = "hist/one"
    branch(c, s, b)
    ok(c.patch(key_path(s, b, kid), json={"name": "ivt.hist2"}))
    ride = f"Ride today {tag('ride')}"
    ok(c.patch(key_path(s, b, kid), json={"source": ride}))
    de = segment(c, seg_id(c, s, "ivt.hist2", "de", b))
    fr = segment(c, seg_id(c, s, "ivt.hist2", "fr", b))
    assert (de["status"], de["value"], de["score"]) == ("needs_review", "Jetzt fahren", 100) and de["history"][-1]["to"] == "needs_review"
    assert fr["status"] == "needs_review" and [i["category"] for i in fr["issues"]] == ["accuracy"]
    assert segment(c, seg_id(c, s, "ivt.hist", "de"))["status"] == "approved", "main is untouched"
    queued = [x for x in ok(c.get("/api/review-queue?lang=de"))["segments"] if x["segment_id"] == de["id"]]
    assert queued and (queued[0]["key"], queued[0]["source"]) == ("ivt.hist2", ride), "the edit shows in the review queue"
    ok(move(c, s, b, "in_review"))
    ok(merge(c, s, b))
    k = key_named(c, s, "ivt.hist2")
    assert k and k["id"] == kid and k["source"] == ride
    revs = ok(c.get(f"/api/projects/{s}/keys/{kid}/history"))["revisions"]
    fields = [r["field"] for r in revs]
    assert fields[0] == "created" and "merged" in fields
    rename = next(r for r in revs if r["field"] == "name")
    edit = next(r for r in revs if r["field"] == "source")
    assert (rename["from"], rename["to"], rename["branch"]) == ("ivt.hist", "ivt.hist2", b)
    assert (edit["from"], edit["to"]) == ("Ride now", ride)
    assert [r["at"] for r in revs] == sorted(r["at"] for r in revs)

    rb = "hist/gone"
    gid = add_key(c, s, "ivt.gone", "Gone soon")
    branch(c, s, rb)
    sid = seg_id(c, s, "ivt.gone", "de", rb)
    make_needs_review(c, sid, "Bald weg")
    rid, email, key, _ = invite(c, s)
    ok(assign(c, s, rid, "de", rb), 201)
    ok(c.delete(key_path(s, rb, gid)), 204)
    assert key_named(c, s, "ivt.gone", rb) is None
    rv = api(app_url, email, key)
    item = [x for x in ok(rv.get("/api/review-queue"))["segments"] if x["segment_id"] == sid]
    assert item and item[0]["removed"] is True and item[0]["source"] is None
    rejects(rv.post(f"/api/segments/{sid}/approve", json={}), 409, "key_removed")
    rejects(rv.post(f"/api/segments/{sid}/correct", json={"value": "Neu"}), 409, "key_removed")
    with browse(browser, app_url, "/review", who=rv) as page:
        lang = "de"
        card = show(page, page.get_by_role("region", name="Review queue").get_by_role("article", name=f"ivt.gone ({lang})"), "the removed key's card")
        reads(page, card, f"This key was removed on {rb}.", "removed placeholder copy")
        expect(card.get_by_role("button", name="Approve")).to_be_disabled()
        expect(card.get_by_role("button", name="Correct")).to_be_disabled()


def test_branch_lifecycle_and_limits(app_url):
    c = api(app_url)
    s = project(c, "life")["slug"]
    names = [f"life/b{i}" for i in range(1, 6)]
    for n in names:
        b = branch(c, s, n)
        assert b["state"] == "open" and b["is_main"] is False
    b1, b2, b3, b4, b5 = names
    rejects(c.post(f"/api/projects/{s}/branches", json={"name": "life/b6"}), 409, "branch_limit")
    assert ok(move(c, s, b1, "in_review"))["state"] == "in_review"
    assert rejects(move(c, s, b1, "in_review"), 409, "illegal_transition")["details"] == {"from": "in_review", "to": "in_review"}
    rejects(c.post(f"/api/projects/{s}/branches", json={"name": "life/b6"}), 409, "branch_limit")
    assert ok(move(c, s, b1, "open"))["state"] == "open"
    assert rejects(move(c, s, b1, "open"), 409, "illegal_transition")["details"] == {"from": "open", "to": "open"}
    assert ok(move(c, s, b2, "abandoned"))["state"] == "abandoned"
    for to in ("open", "in_review", "abandoned"):
        assert rejects(move(c, s, b2, to), 409, "illegal_transition")["details"] == {"from": "abandoned", "to": to}
        rejects(move(c, s, "main", to), 409, "illegal_transition")
    rejects(c.post(f"/api/projects/{s}/branches", json={"name": b2}), 409, "branch_exists")
    branch(c, s, "life/b6")
    rejects(c.post(f"/api/projects/{s}/branches", json={"name": "life/b7"}), 409, "branch_limit")
    ok(move(c, s, b3, "in_review"))
    ok(merge(c, s, b3))
    for to in ("open", "in_review", "abandoned"):
        assert rejects(move(c, s, b3, to), 409, "illegal_transition")["details"]["from"] == "merged"
    ok(move(c, s, b4, "in_review"))
    assert ok(move(c, s, b4, "abandoned"))["state"] == "abandoned"
    rejects(c.post(f"/api/projects/{s}/branches", json={"name": "Life/Bad Name"}), 422, "validation_failed")
    states = {b["name"]: b["state"] for b in ok(c.get(f"/api/projects/{s}/branches"))["branches"]}
    assert states == {"main": "open", b1: "open", b2: "abandoned", b3: "merged", b4: "abandoned", b5: "open", "life/b6": "open"}


def test_wf_branching_limit(browser, app_url):
    c = api(app_url)
    s = project(c, "liml")["slug"]
    for i in range(1, 6):
        branch(c, s, f"lim/b{i}")
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("button", name="New branch"), "New branch"))
        dlg = show(page, page.get_by_role("dialog", name="New branch"), "dialog New branch")
        fill(dlg.get_by_role("textbox", name="Branch name"), "Bad Name")
        click(dlg.get_by_role("button", name="Create branch"))
        reads(page, problems(page), "Use lowercase letters, digits, slashes, hyphens or underscores.", "bad branch name copy")
        fill(dlg.get_by_role("textbox", name="Branch name"), "lim/b6")
        click(dlg.get_by_role("button", name="Create branch"))
        reads(page, problems(page), "This project already has five open branches. Merge or abandon one first.", "branch limit copy")
    assert len(branch_names(c, s)) == 6


def test_key_edits_on_branch(app_url):
    c = api(app_url)
    s = project(c, "kedit")["slug"]
    add_key(c, s, "ivt.base", "Base")
    b = "edit/one"
    branch(c, s, b)
    kid = add_key(c, s, "ivt.new", "Fresh", b)
    rejects(c.post(f"/api/projects/{s}/branches/{enc(b)}/keys", json={"name": "ivt.new", "source": "Again"}), 409, "key_exists")
    rejects(c.patch(key_path(s, b, kid), json={"name": "ivt.base"}), 409, "key_exists")
    rejects(c.post(f"/api/projects/{s}/branches/{enc(b)}/keys", json={"name": "bad name", "source": "x"}), 422, "validation_failed")
    rejects(c.post(f"/api/projects/{s}/branches/{enc(b)}/keys", json={"name": "ivt.blank", "source": "   "}), 422, "validation_failed")
    new_name = f"ivt.renamed-{tag('kedit')}"
    assert ok(c.patch(key_path(s, b, kid), json={"name": new_name}))["name"] == new_name
    ok(c.patch(key_path(s, b, kid), json={"source": "Fresh edit"}))
    sid = seg_id(c, s, new_name, "de", b)
    assert set_value(c, sid, "Frisch")["status"] == "drafted"
    ok(c.delete(key_path(s, b, kid)), 204)
    assert key_named(c, s, new_name, b) is None
    assert [r["field"] for r in ok(c.get(f"/api/projects/{s}/keys/{kid}/history"))["revisions"]] == ["created", "name", "source", "deleted"]

    base = key_named(c, s, "ivt.base", b)
    bsid = base["translations"]["de"]["segment_id"]
    for state, code in (("in_review", "branch_not_open"), ("abandoned", "branch_closed")):
        ok(move(c, s, b, state))
        before = keys(c, s, b)
        rejects(c.post(f"/api/projects/{s}/branches/{enc(b)}/keys", json={"name": "ivt.locked", "source": "Locked"}), 409, code)
        rejects(c.patch(key_path(s, b, base["id"]), json={"source": "Changed"}), 409, code)
        rejects(c.delete(key_path(s, b, base["id"])), 409, code)
        rejects(c.put(f"/api/segments/{bsid}/value", json={"value": "Gesperrt"}), 409, code)
        assert keys(c, s, b) == before


def test_wf_branching_happy(browser, app_url):
    c = api(app_url)
    s = project(c, "bru")["slug"]
    nb = "ui/new-rail"
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("button", name="New branch"), "New branch"))
        dlg = show(page, page.get_by_role("dialog", name="New branch"), "dialog New branch")
        fill(dlg.get_by_role("textbox", name="Branch name"), nb)
        click(dlg.get_by_role("button", name="Create branch"))
        reads(page, updates(page), f"Created branch {nb}.", "create branch success copy")
        show(page, page.get_by_role("tab", name=nb), "the new branch tab")
    assert {b["name"]: b["state"] for b in ok(c.get(f"/api/projects/{s}/branches"))["branches"]}[nb] == "open"


def rail_project(c):
    s = project(c, "rail", targets=("de", "fr"), ai_routes={"de": "ivt-rail-de", "fr": "ivt-rail-fr"})["slug"]
    for n, src in (("ivt.r1", "Rail one"), ("ivt.r2", "Rail two"), ("ivt.r3", "Rail three")):
        add_key(c, s, n, src)
    ids = {k["name"]: k["id"] for k in keys(c, s)}
    for b in ("rail/one", "rail/two", "rail/closed"):
        branch(c, s, b)
    ok(move(c, s, "rail/closed", "abandoned"))
    for n in ("ivt.n1", "ivt.n2", "ivt.n3"):
        add_key(c, s, n, f"New {n}", "rail/one")
    ok(c.patch(key_path(s, "rail/one", ids["ivt.r1"]), json={"source": "Rail one edited"}))
    ok(c.patch(key_path(s, "rail/one", ids["ivt.r2"]), json={"source": "Rail two edited"}))
    ok(c.patch(key_path(s, "rail/one", ids["ivt.r3"]), json={"source": "Rail three branch"}))
    ok(c.patch(key_path(s, "main", ids["ivt.r3"]), json={"source": "Rail three main"}))
    return s


BRANCH_CAPS = (("New keys", "new_keys"), ("Edited keys", "edited_keys"), ("Below MQM threshold", "below_threshold"))
MAIN_CAPS = (("Keys", "keys"), ("Needs review", "needs_review"), ("Below MQM threshold", "below_threshold"))


def panel_shows(page, name, pv, caps, extra=()):
    panel = page.get_by_role("tabpanel", name=name)

    def good(t):
        figures = all(has_figure(t, cap, pv[k]) for cap, k in caps)
        conflicts = "conflicts" not in pv or not pv["conflicts"] or has_figure(t, "Conflicts", len(pv["conflicts"]))
        return figures and conflicts and all(x in t for x in extra)

    return reads(page, panel, good, f"tab panel {name} shows the merge-preview counts {pv}")


def test_branch_rail_keyboard(browser, app_url):
    c = api(app_url)
    s = rail_project(c)
    pv1, pv2, pvm = preview(c, s, "rail/one"), preview(c, s, "rail/two"), preview(c, s, "main")
    with browse(browser, app_url, f"/projects/{s}?branch={enc('rail/one')}", who=c) as page:
        tablist = show(page, page.get_by_role("tablist", name="Branches"), "branch rail")
        names = tab_texts(tablist)
        assert len(names) == 3 and "main" in names[0] and "rail/one" in names[1] and "rail/two" in names[2], names
        one = page.get_by_role("tab", name="rail/one", exact=True)
        expect(one).to_have_attribute("aria-selected", "true")
        text = panel_shows(page, "rail/one", pv1, BRANCH_CAPS, ("Conflicting keys", "ivt.r3"))
        panel = page.get_by_role("tabpanel", name="rail/one")
        show(page, panel.get_by_role("link", name="Open editor"), "Open editor")
        show(page, panel.get_by_role("link", name="Open merge preview"), "Open merge preview")
        show(page, panel.get_by_role("img", name="connects to the repository, translation memory and AI route"), "hub diagram")
        diagram = panel.text_content() or ""
        for bit in (f"ivt-owner/{s}", "TM 0", "de → ivt-rail-de", "fr → ivt-rail-fr"):
            assert bit in diagram, (bit, diagram)
        one.focus()
        page.evaluate("() => { window.__ivtNoReload = true; }")
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role')") != "tab", "only the selected tab is in the Tab order"
        steps = (("ArrowRight", "rail/two"), ("ArrowRight", "main"), ("ArrowLeft", "rail/two"), ("Home", "main"), ("End", "rail/two"))
        one.focus()
        for key, want in steps:
            page.keyboard.press(key)
            tab = page.get_by_role("tab", name=want, exact=True)
            expect(tab).to_have_attribute("aria-selected", "true")
            expect(tab).to_be_focused()
            assert query_branch(page) == want
        assert page.evaluate("() => window.__ivtNoReload === true"), "the URL changed without a reload"
        panel_shows(page, "rail/two", pv2, BRANCH_CAPS)
        add_key(c, s, "ivt.late", "Late key", "rail/two")
        page.keyboard.press("Home")
        panel_shows(page, "main", pvm, MAIN_CAPS, ("Last publish", "Never"))
        page.keyboard.press("End")
        panel_shows(page, "rail/two", preview(c, s, "rail/two"), BRANCH_CAPS)
        for target in ("ivt-unknown", "rail/closed"):
            page.goto(f"{app_url}/projects/{s}?branch={enc(target)}")
            show(page, page.get_by_role("tablist", name="Branches"), "branch rail")
            expect(page.get_by_role("tab", name="main", exact=True)).to_have_attribute("aria-selected", "true")
            deadline = time.monotonic() + UI_WAIT_S
            while query_branch(page) != "main" and time.monotonic() < deadline:
                advance(page, STEP_MS)
            assert query_branch(page) == "main"


def test_branch_rail_motion(browser, app_url):
    c = api(app_url)
    s = rail_project(c)
    pv2 = preview(c, s, "rail/two")
    for reduced in ("no-preference", "reduce"):
        with browse(browser, app_url, f"/projects/{s}?branch=main", who=c, reduced=reduced) as page:
            show(page, page.get_by_role("tablist", name="Branches"), "branch rail")
            panel_shows(page, "main", preview(c, s, "main"), MAIN_CAPS)
            page.evaluate(MOTION_JS)
            page.get_by_role("tab", name="main", exact=True).focus()
            page.keyboard.press("End")
            tab = page.get_by_role("tab", name="rail/two", exact=True)
            assert tab.get_attribute("aria-selected") == "true" and query_branch(page) == "rail/two", "state changes at the moment of choosing"
            panel_shows(page, "rail/two", pv2, BRANCH_CAPS)
            log = motion_log(page)
            if reduced == "reduce":
                slow = [m for m in log if m["duration"] > INSTANT_MS]
                assert not slow, f"reduced motion swaps at once: {slow}"
                continue
            deadline = time.monotonic() + UI_WAIT_S
            while time.monotonic() < deadline:
                log = motion_log(page)
                if any(any(g in m["prop"] for g in GEOMETRY) for m in log) and any(m["prop"] == "opacity" for m in log):
                    break
                advance(page, STEP_MS / 2)
            geo = [m for m in log if any(g in m["prop"] for g in GEOMETRY) and m["duration"] > 0]
            fades = [m for m in log if m["prop"] == "opacity" and m["duration"] > 0]
            assert geo and all(m["duration"] <= UI_MAX_MS for m in geo), f"the underline slides and resizes: {log}"
            assert fades and all(m["duration"] <= UI_MAX_MS for m in fades), f"the panels crossfade: {log}"


def test_merge_preview_classification(app_url):
    c = api(app_url)
    s = project(c, "prev")["slug"]
    src = {"a": "Alpha", "b": "Beta", "c": "Gamma", "d": "Delta", "e": "Epsilon", "f": "Zeta", "h": "Eta", "j": "Iota"}
    ids = {n: add_key(c, s, f"ivt.{n}", v) for n, v in src.items()}
    set_value(c, seg_id(c, s, "ivt.h", "de"), "Eta base")
    b = "prev/one"
    branch(c, s, b)
    add_key(c, s, "ivt.n1", "New one", b)
    add_key(c, s, "ivt.n2", "New two", b)
    ok(c.patch(key_path(s, b, ids["a"]), json={"source": "Alpha changed"}))
    ok(c.delete(key_path(s, b, ids["b"])), 204)
    ok(c.patch(key_path(s, b, ids["c"]), json={"source": "Gamma branch"}))
    ok(c.patch(key_path(s, "main", ids["c"]), json={"source": "Gamma main"}))
    ok(c.delete(key_path(s, b, ids["d"])), 204)
    ok(c.patch(key_path(s, "main", ids["d"]), json={"source": "Delta main"}))
    ok(c.delete(key_path(s, "main", ids["e"])), 204)
    ok(c.patch(key_path(s, b, ids["e"]), json={"source": "Epsilon branch"}))
    ok(c.patch(key_path(s, b, ids["f"]), json={"name": "ivt.x"}))
    add_key(c, s, "ivt.x", "Main x")
    set_value(c, seg_id(c, s, "ivt.h", "de", b), "Eta branch")
    set_value(c, seg_id(c, s, "ivt.h", "de"), "Eta main")
    make_needs_review(c, seg_id(c, s, "ivt.j", "de", b), "Iota branch")
    add_key(c, s, "ivt.k", "Kappa")
    make_needs_review(c, seg_id(c, s, "ivt.k", "de"), "Kappa main")
    pv = preview(c, s, b)
    assert (pv["new_keys"], pv["edited_keys"], pv["deleted_keys"], pv["below_threshold"], pv["needs_review"]) == (2, 2, 1, 1, 1), pv
    assert pv["keys"] == len(keys(c, s, b))
    got = {x["id"]: x for x in pv["conflicts"]}
    assert set(got) == {f"{ids['c']}:source", f"{ids['d']}:presence", f"{ids['e']}:presence", f"{ids['f']}:name", f"{ids['h']}:translation:de"}
    cs = got[f"{ids['c']}:source"]
    assert (cs["field"], cs["base"], cs["main"], cs["branch"], cs["resolution"], cs["key_id"]) == ("source", "Gamma", "Gamma main", "Gamma branch", None, ids["c"])
    ct = got[f"{ids['h']}:translation:de"]
    assert (ct["base"], ct["main"], ct["branch"]) == ("Eta base", "Eta main", "Eta branch")
    pm = preview(c, s, "main")
    assert (pm["new_keys"], pm["edited_keys"], pm["deleted_keys"], pm["conflicts"]) == (0, 0, 0, [])
    assert (pm["keys"], pm["needs_review"], pm["below_threshold"]) == (len(keys(c, s)), 1, 1)


def make_conflict(c, s, name, b):
    kid = add_key(c, s, name, "Hold base")
    branch(c, s, b)
    ok(c.patch(key_path(s, b, kid), json={"source": "Hold branch"}))
    ok(c.patch(key_path(s, "main", kid), json={"source": "Hold main"}))
    return kid, f"{kid}:source"


def test_conflict_holds_and_resolution(app_url):
    s1 = api(app_url)
    s2 = api(app_url)
    s = project(s1, "hold")["slug"]
    kid, cid = make_conflict(s1, s, "ivt.hold", "hold/one")
    b = "hold/one"
    first = ok(hold(s1, s, b, cid))
    assert first["conflict_id"] == cid and first["held_until"]
    assert rejects(hold(s2, s, b, cid), 409, "conflict_held")["details"]["held_until"]
    r = resolve(s2, s, b, cid, "main")
    assert r.status_code == 409 and err(r) in ("hold_required", "conflict_held"), r.text
    assert ok(hold(s1, s, b, cid))["held_until"] >= first["held_until"]
    rejects(resolve(s1, s, b, cid, "custom"), 422, "validation_failed")
    res = ok(resolve(s1, s, b, cid, "branch"))
    assert res["resolution"]["choice"] == "branch" and res["resolution"]["value"] == res["branch"]
    ok(hold(s2, s, b, cid))
    ok(resolve(s2, s, b, cid, "custom", "Hold custom"))
    ok(s1.patch(key_path(s, "main", kid), json={"source": "Hold main again"}))
    again = {x["id"]: x for x in preview(s1, s, b)["conflicts"]}[cid]
    assert again["resolution"] is None, "a later main change voids the resolution"

    _, cid2 = make_conflict(s1, s, "ivt.race", "hold/race")
    sessions = [api(app_url) for _ in range(5)]
    results = together([lambda x=x: hold(x, s, "hold/race", cid2) for x in sessions])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409, 409]
    assert all(err(r) == "conflict_held" for r in results if r.status_code == 409)


def test_conflict_hold_expires_on_server_clock():
    base = instance("APP_SHORT_URL")
    s1, s2 = api(base), api(base)
    s = project(s1, "hexp")["slug"]
    _, cid = make_conflict(s1, s, "ivt.hexp", "hold/exp")
    until = ok(hold(s1, s, "hold/exp", cid))["held_until"]

    def server_now():
        return httpx.get(base + "/api/health", timeout=REQUEST_TIMEOUT_S).headers.get("date")

    from email.utils import parsedate_to_datetime
    from datetime import datetime

    expiry = datetime.fromisoformat(until.replace("Z", "+00:00"))
    poll(server_now, lambda d: d and parsedate_to_datetime(d) > expiry, SHORT_WAIT_S, "the server clock passes held_until")
    rejects(resolve(s1, s, "hold/exp", cid, "main"), 409, "hold_required")
    ok(hold(s2, s, "hold/exp", cid))


def test_merge_into_main(app_url):
    c = api(app_url)
    s = project(c, "merge")["slug"]
    mt = tag("mrg")
    v_edit, v_src, v_main, v_new, v_res = (f"Bearbeite {mt}", f"Edit me now {mt}", f"Main M2 {mt}", f"Neu {mt}", f"Resolved {mt}")
    gone_key = f"ivt.{'d1'}"
    ids = {n: add_key(c, s, f"ivt.{n}", v) for n, v in (("e1", "Edit me"), ("d1", "Delete me"), ("t1", "Translate me"), ("m1", "Main only"))}
    make_approved(c, seg_id(c, s, "ivt.e1", "de"), v_edit)
    make_approved(c, seg_id(c, s, "ivt.t1", "de"), "Uebersetze mich")
    make_approved(c, seg_id(c, s, "ivt.m1", "de"), "Nur Haupt")
    b = "merge/one"
    branch(c, s, b)
    ok(c.patch(key_path(s, b, ids["e1"]), json={"source": v_src}))
    ok(c.delete(key_path(s, b, ids["d1"])), 204)
    set_value(c, seg_id(c, s, "ivt.t1", "de", b), "Branch V")
    set_value(c, seg_id(c, s, "ivt.t1", "de"), "Main V")
    set_value(c, seg_id(c, s, "ivt.m1", "de"), v_main)
    nid = add_key(c, s, "ivt.n1", "Brand new", b)
    set_value(c, seg_id(c, s, "ivt.n1", "de", b), v_new)
    rejects(merge(c, s, b), 409, "illegal_transition")
    ok(move(c, s, b, "in_review"))
    cid = f"{ids['t1']}:translation:de"
    assert rejects(merge(c, s, b), 409, "conflicts_unresolved")["details"]["conflicts"] == [cid]
    assert key_named(c, s, "ivt.n1") is None, "a blocked merge changes nothing"
    ok(hold(c, s, b, cid))
    ok(resolve(c, s, b, cid, "custom", v_res))
    before_merge = snapshot(c, s)
    m = ok(merge(c, s, b))
    assert (m["new_keys"], m["edited_keys"], m["deleted_keys"], m["conflicts_resolved"]) == (1, 1, 1, 1) and m["merge_id"]
    assert {x["name"]: x["state"] for x in ok(c.get(f"/api/projects/{s}/branches"))["branches"]}[b] == "merged"
    main = {k["name"]: k for k in keys(c, s)}
    assert gone_key not in main and main["ivt.e1"]["id"] == ids["e1"] and main["ivt.e1"]["source"] == v_src
    assert main["ivt.e1"]["translations"]["de"]["value"] == v_edit
    assert main["ivt.t1"]["translations"]["de"]["value"] == v_res
    assert main["ivt.m1"]["translations"]["de"]["value"] == v_main, "a main-only change is never overwritten"
    assert main["ivt.n1"]["id"] == nid and main["ivt.n1"]["translations"]["de"]["value"] == v_new
    assert "merged" in [r["field"] for r in ok(c.get(f"/api/projects/{s}/keys/{ids['e1']}/history"))["revisions"]]
    merge_op = next(o for o in operations(c, s) if o["kind"] == "merge" and o["restorable"])
    ok(c.post(f"/api/projects/{s}/operations/{merge_op['id']}/restore", json={}))
    assert snapshot(c, s) == before_merge, "restoring the merge returns main exactly"

    b2 = "merge/race"
    branch(c, s, b2)
    add_key(c, s, "ivt.race", "Race", b2)
    ok(move(c, s, b2, "in_review"))
    results = together([lambda: merge(c, s, b2), lambda: merge(api(app_url), s, b2)])
    assert sorted(r.status_code for r in results) == [200, 409]
    assert err(next(r for r in results if r.status_code == 409)) == "illegal_transition"
    assert [k["name"] for k in keys(c, s)].count("ivt.race") == 1


def test_wf_merging_happy(browser, app_url):
    c = api(app_url)
    s = project(c, "mjour")["slug"]
    b = "mj/one"
    key = "ivt.mj"
    kid, _ = make_conflict(c, s, key, b)
    branch_value = preview(c, s, b)["conflicts"][0]["branch"]
    with browse(browser, app_url, f"/projects/{s}?branch={enc(b)}", who=c) as page:
        panel = show(page, page.get_by_role("tabpanel", name=b), "branch panel")
        reads(page, panel, key, "conflicting key listed")
        click(panel.get_by_role("link", name="Open merge preview"))
        show(page, page.get_by_role("heading", name=f"Merge {b} into main"), "merge heading")
        click(page.get_by_role("button", name="Request review"))
        reads(page, updates(page), lambda t: f"Branch {b} is" in t and "in review" in t.lower(), "request review copy")
        click(page.get_by_role("button", name="Merge into main"))
        reads(page, problems(page), "Resolve every conflict before merging. 1 left.", "unresolved merge copy")
        click(page.get_by_role("button", name=f"Resolve {key} source"))
        dlg = show(page, page.get_by_role("dialog", name="Resolve conflict"), "Resolve conflict dialog")
        check(dlg.get_by_role("radio", name="Keep branch"))
        click(dlg.get_by_role("button", name="Save resolution"))
        reads(page, updates(page), "Resolution saved.", "resolution copy")
        click(page.get_by_role("button", name="Merge into main"))
        reads(page, updates(page), f"Merged {b} into main.", "merge copy")
    assert {x["name"]: x["state"] for x in ok(c.get(f"/api/projects/{s}/branches"))["branches"]}[b] == "merged"
    assert key_named(c, s, key)["source"] == branch_value


def test_wf_merging_hold_refused(browser, app_url):
    c = api(app_url)
    s = project(c, "mheld")["slug"]
    b = "mh/one"
    key = "ivt.mh"
    _, cid = make_conflict(c, s, key, b)
    ok(hold(api(app_url), s, b, cid))
    with browse(browser, app_url, f"/projects/{s}/merge?branch={enc(b)}", who=c) as page:
        click(show(page, page.get_by_role("button", name=f"Resolve {key} source"), "Resolve button"))
        text = reads(page, problems(page), "This conflict is being resolved in another session until", "conflict_held copy")
        assert HHMM.search(text), text
        assert page.get_by_role("dialog", name="Resolve conflict").count() == 0
    assert {x["id"]: x for x in preview(c, s, b)["conflicts"]}[cid]["resolution"] is None


def snapshot(c, slug):
    state = {"keys": [], "segments": {}}
    for k in keys(c, slug):
        state["keys"].append((k["id"], k["name"], k["source"]))
        for _, summary in sorted(k["translations"].items()):
            full = segment(c, summary["segment_id"])
            state["segments"][summary["segment_id"]] = {f: full.get(f) for f in SEGMENT_FIELDS}
    state["tm"] = sorted((e["id"], e["source"], e["target"], e["target_language"], e.get("import_id")) for e in tm_entries(c, slug)["entries"])
    return state


def rich_main(c, s, prefix):
    for n in ("x1", "x2", "x3"):
        add_key(c, s, f"ivt.{n}", f"{prefix} {n}")
    make_needs_review(c, seg_id(c, s, "ivt.x2", "de"), f"{prefix} wert")
    ok(c.post(f"/api/segments/{seg_id(c, s, 'ivt.x2', 'de')}/comments", json={"body": "Check tone"}), 201)
    make_approved(c, seg_id(c, s, "ivt.x3", "de"), f"{prefix} fertig")


def test_restore_import_exact(app_url):
    c = api(app_url)
    s = project(c, "rimp")["slug"]
    rich_main(c, s, "Rimp")
    ok(import_tm(c, s, csv_bytes([("Older entry", "Alter", "de")])), 201)
    before = snapshot(c, s)
    imp = ok(import_tm(c, s, csv_bytes([("rimp x1", "Gefuellt", "de"), ("Spare", "Ersatz", "de")])), 201)
    assert snapshot(c, s) != before
    op = next(o for o in operations(c, s) if o["kind"] == "import")
    done = ok(c.post(f"/api/projects/{s}/operations/{op['id']}/restore", json={}))
    assert done["restored_at"] and done["restorable"] is False
    assert snapshot(c, s) == before
    assert c.get(f"/api/projects/{s}/tm/imports/{imp['import_id']}/original").status_code == 200


def test_restore_merge_exact(app_url):
    c = api(app_url)
    s = project(c, "rmrg")["slug"]
    rich_main(c, s, "Rmrg")
    b = "rm/one"
    branch(c, s, b)
    ids = {k["name"]: k["id"] for k in keys(c, s)}
    add_key(c, s, "ivt.new", "New key", b)
    ok(c.patch(key_path(s, b, ids["ivt.x1"]), json={"source": "Rmrg x1 edited"}))
    ok(c.delete(key_path(s, b, ids["ivt.x3"])), 204)
    ok(c.patch(key_path(s, b, ids["ivt.x2"]), json={"source": "Rmrg branch"}))
    ok(c.patch(key_path(s, "main", ids["ivt.x2"]), json={"source": "Rmrg main"}))
    ok(move(c, s, b, "in_review"))
    cid = f"{ids['ivt.x2']}:source"
    ok(hold(c, s, b, cid))
    ok(resolve(c, s, b, cid, "branch"))
    before = snapshot(c, s)
    ok(merge(c, s, b))
    assert snapshot(c, s) != before
    op = next(o for o in operations(c, s) if o["kind"] == "merge")
    ok(c.post(f"/api/projects/{s}/operations/{op['id']}/restore", json={}))
    assert snapshot(c, s) == before
    assert {x["name"]: x["state"] for x in ok(c.get(f"/api/projects/{s}/branches"))["branches"]}[b] == "in_review"
    assert {x["id"]: x for x in preview(c, s, b)["conflicts"]}[cid]["resolution"]["choice"] == "branch"


def test_wf_restore_import(browser, app_url):
    c = api(app_url)
    s = project(c, "rwui")["slug"]
    add_key(c, s, "ivt.r", "Restore me")
    before = snapshot(c, s)
    ok(import_tm(c, s, csv_bytes([("Restore me", "Wiederherstellen", "de")])), 201)
    with browse(browser, app_url, f"/projects/{s}/tm", who=c) as page:
        click(show(page, page.get_by_role("button", name="Restore"), "Restore button"))
        dlg = page.get_by_role("dialog", name="Restore")
        with contextlib.suppress(AssertionError, pytest.fail.Exception):
            click(show(page, dlg.get_by_role("button", name="Restore now"), "Restore now", seconds=3))
        reads(page, updates(page), "Restored the state before this import.", "restore copy")
    assert snapshot(c, s) == before


def test_restore_refused_after_later_changes(app_url):
    c = api(app_url)
    for kind in ("comment", "value", "key", "import"):
        s = project(c, "rsup")["slug"]
        add_key(c, s, "ivt.k", "Later change")
        ok(import_tm(c, s, csv_bytes([("Spare entry", "Ersatz", "de")])), 201)
        sid = seg_id(c, s, "ivt.k", "de")
        if kind == "comment":
            ok(c.post(f"/api/segments/{sid}/comments", json={"body": "Later"}), 201)
        elif kind == "value":
            set_value(c, sid, "Spaeter")
        elif kind == "key":
            add_key(c, s, "ivt.later", "Later key")
        else:
            ok(import_tm(c, s, csv_bytes([("Another", "Noch", "de")])), 201)
        before = snapshot(c, s)
        op = [o for o in operations(c, s) if o["kind"] == "import"][-1]
        rejects(c.post(f"/api/projects/{s}/operations/{op['id']}/restore", json={}), 409, "restore_superseded")
        assert snapshot(c, s) == before, kind
    s = project(c, "rtwice")["slug"]
    ok(import_tm(c, s, csv_bytes([("Spare entry", "Ersatz", "de")])), 201)
    branch(c, s, "rt/side")
    add_key(c, s, "ivt.side", "Side", "rt/side")
    op = operations(c, s)[0]
    ok(c.post(f"/api/projects/{s}/operations/{op['id']}/restore", json={}))
    rejects(c.post(f"/api/projects/{s}/operations/{op['id']}/restore", json={}), 409, "already_restored")


def test_wf_restore_superseded(browser, app_url):
    c = api(app_url)
    s = project(c, "rsui")["slug"]
    add_key(c, s, "ivt.base", "Base")
    branch(c, s, "rs/one")
    branch(c, s, "rs/view")
    add_key(c, s, "ivt.merged", "Merged", "rs/one")
    ok(move(c, s, "rs/one", "in_review"))
    ok(merge(c, s, "rs/one"))
    ok(c.post(f"/api/segments/{seg_id(c, s, 'ivt.base', 'de')}/comments", json={"body": "Later"}), 201)
    with browse(browser, app_url, f"/projects/{s}/merge?branch={enc('rs/view')}", who=c) as page:
        click(show(page, page.get_by_role("button", name="Restore"), "operation Restore"))
        dlg = show(page, page.get_by_role("dialog", name="Restore"), "Restore dialog")
        click(dlg.get_by_role("button", name="Restore now"))
        reads(page, problems(page), "Later changes were made after this, so it can't be restored exactly.", "restore_superseded copy")
    assert key_named(c, s, "ivt.merged") is not None


def test_project_erasure(app_url, svix):
    c = api(app_url)
    p = project(c, "erase")
    s, pid = p["slug"], p["id"]
    keep = project(c, "keep")["slug"]
    add_key(c, s, "ivt.e", "Erase me")
    data = csv_bytes([("Erase me", "Loesch mich", "de")])
    imp = ok(import_tm(c, s, data), 201)
    assert S3().get(imp["object_key"]) == data
    branch(c, s, "er/one")
    ok(upload_source(c, s, "er/one", b'{"ivt.up": "Up"}'), 201)
    tok = ok(c.post(f"/api/projects/{s}/tokens", json={"label": "ci"}), 201)["token"]
    ok(c.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL}))
    poll(lambda: svix_app(svix, pid), bool, UI_WAIT_S, "Svix holds the project's application")
    rid, email, key, _ = invite(c, s)
    rid2, email2, key2, name2 = invite(c, keep)
    ok(c.post(f"/api/projects/{s}/reviewers", json={"name": name2, "email": email2}))
    make_needs_review(c, seg_id(c, s, "ivt.e", "de"), "Weg")
    ok(assign(c, s, rid), 201)
    rejects(c.request("DELETE", f"/api/projects/{s}", json={"confirm": "wrong-slug"}), 422, "validation_failed")
    assert ok(c.get(f"/api/projects/{s}"))["slug"] == s
    started = ok(c.get("/api/audit"))["entries"][0]["at"]
    ok(c.request("DELETE", f"/api/projects/{s}", json={"confirm": s}), 204)

    rejects(c.get(f"/api/projects/{s}"), 404, "not_found")
    for path in ("tm", "branches", "operations", "tokens", "reviewers", "events", "publishes", "source-files"):
        rejects(c.get(f"/api/projects/{s}/{path}"), 404, "not_found")
    assert httpx.get(f"{app_url}/api/ci/projects/{s}/locales/de.json", headers={"Authorization": f"Bearer {tok}"}, timeout=REQUEST_TIMEOUT_S).status_code in (401, 404)
    assert httpx.get(f"{app_url}/projects/{s}", cookies={"desk_session": c.cookies.get("desk_session")}, timeout=REQUEST_TIMEOUT_S).status_code == 404
    assert S3().keys(f"projects/{pid}/") == []
    poll(lambda: svix_app(svix, pid), lambda a: a == [], UI_WAIT_S, "the Svix application is deleted")
    assert httpx.post(app_url + "/api/session", json={"email": email, "password": key}, timeout=REQUEST_TIMEOUT_S).status_code == 401
    rv2 = api(app_url, email2, key2)
    assert [x["slug"] for x in ok(rv2.get("/api/projects"))["projects"]] == [keep]
    entries = ok(c.get("/api/audit"))["entries"]
    assert not [e for e in entries if s in json.dumps(e)]
    assert [e for e in entries if e["action"] == "project.erased" and e["at"] >= started and not e.get("project") and not e.get("detail")]
    assert s not in c.get("/api/audit.csv").text
    pg = Postgres()
    assert rows_mentioning(pg, s) == 0 and rows_mentioning(pg, pid) == 0
    assert ok(c.post("/api/projects", json={"slug": s, "name": "Again", "client": "Again", "source_language": "en", "target_languages": ["de"], "repository": "ivt-owner/again"}), 201)["id"] != pid


def test_wf_erasure_happy(browser, app_url):
    c = api(app_url)
    p = project(c, "eraui")
    s = p["slug"]
    with browse(browser, app_url, f"/projects/{s}/settings", who=c) as page:
        click(show(page, page.get_by_role("button", name="Erase project"), "Erase project"))
        dlg = show(page, page.get_by_role("dialog", name="Erase project"), "Erase project dialog")
        fill(dlg.get_by_role("textbox", name="Type the project slug to confirm"), "not-it")
        click(dlg.get_by_role("button", name="Erase everything"))
        reads(page, problems(page), "Type the project slug exactly to confirm.", "wrong slug copy")
        assert ok(c.get(f"/api/projects/{s}"))["slug"] == s
        fill(dlg.get_by_role("textbox", name="Type the project slug to confirm"), s)
        click(dlg.get_by_role("button", name="Erase everything"))
        reads(page, updates(page), f"Erased {p['name']} and every stored file.", "erase copy")
    rejects(c.get(f"/api/projects/{s}"), 404, "not_found")


def test_audit_entries_and_csv(app_url):
    c = api(app_url)
    p = project(c, "aud", name="=IVT(1)", client="@ivt client")
    s = p["slug"]
    afor = lambda: audit_for(c, s, p["name"], p["id"])
    n0 = len(afor())
    assert n0 == 1
    branch(c, s, "aud/one")
    assert len(afor()) == n0 + 1
    add_key(c, s, "ivt.a", "Audit")
    assert len(afor()) == n0 + 2
    ok(move(c, s, "aud/one", "abandoned"))
    mine = afor()
    assert len(mine) == n0 + 3 and all(e["actor"] == OWNER_EMAIL for e in mine)
    assert all(re.fullmatch(r"[a-z_]+\.[a-z_]+", e["action"]) for e in mine)
    assert [e["at"] for e in mine] == sorted((e["at"] for e in mine), reverse=True)
    r = c.get("/api/audit.csv")
    assert r.status_code == 200 and r.headers["content-type"].lower() == "text/csv; charset=utf-8"
    raw = r.content.decode("utf-8-sig")
    assert raw.startswith("at,actor,action,project,detail\r\n") and raw.endswith("\r\n")
    rows = list(csv.reader(io.StringIO(raw, newline="")))
    assert all(not cell.startswith(FORMULA_PREFIXES) for row in rows[1:] for cell in row)
    neutral = lambda v: "'" + v if v.startswith(FORMULA_PREFIXES) else v
    by_id = {(e["at"], e["action"], neutral(str(e.get("project") or ""))): e for e in mine}
    for row in rows[1:]:
        e = by_id.get((row[0], row[2], row[3]))
        if e:
            for cell, field in zip(row[1:], ("actor", "action", "project", "detail")):
                assert cell == neutral(str(e.get(field) or "")), (cell, e.get(field))
    fm_email = f"+{tag('fm')}@interline.example"
    inv = c.post(f"/api/projects/{s}/reviewers", json={"name": f"Formula {tag('fm')}", "email": fm_email})
    if inv.status_code == 201:
        add_key(c, s, "ivt.fm", "Formula key")
        fm_sid = seg_id(c, s, "ivt.fm", "de")
        make_needs_review(c, fm_sid, "Formel")
        ok(assign(c, s, inv.json()["id"]), 201)
        approve(api(app_url, fm_email, inv.json()["access_key"]), fm_sid)
        cells = [cell for row in csv.reader(io.StringIO(c.get("/api/audit.csv").content.decode("utf-8-sig"), newline="")) for cell in row]
        assert "'" + fm_email in cells and fm_email not in cells, "the reviewer's actor cell is neutralised with a leading apostrophe"


def test_audit_retention():
    base = instance("APP_SHORT_URL")
    c = api(base)
    p = project(c, "ret")
    s = p["slug"]
    assert audit_for(c, s, p["name"], p["id"]), "a fresh entry is listed"
    poll(lambda: (audit_for(c, s, p["name"], p["id"]), c.get("/api/audit.csv").text), lambda x: not x[0] and s not in x[1], SHORT_WAIT_S, "entries older than AUDIT_RETENTION_SECONDS are never returned")


def test_wf_erasure_audit_log(browser, app_url):
    c = api(app_url)
    s = project(c, "audui")["slug"]
    branch(c, s, "au/one")
    with browse(browser, app_url, "/audit", who=c) as page:
        reads(page, page.get_by_role("table", name="Audit log"), s, "the audit table lists the project")
        link = show(page, page.get_by_role("link", name="Download CSV"), "Download CSV")
        got = page.request.get(urljoin(page.url, link.get_attribute("href")))
        assert got.status == 200 and got.body().decode("utf-8-sig").startswith("at,actor,action,project,detail\r\n")
    assert len(audit_for(c, s)) == 2


def drafting_project(c, prefix):
    p = project(c, prefix, targets=("de", "fr", "ja"), ai_routes={"de": "ivt-route-de", "fr": "ivt-route-fr", "ja": "lexa-formal"})
    s = p["slug"]
    t = tag(prefix)
    names = {f"ivt.a{t}": f"Match {t}", f"ivt.b{t}": f"Draft {t} one", f"ivt.c{t}": f"Draft {t} two"}
    for n, src in names.items():
        add_key(c, s, n, src)
    branch(c, s, "dr/one")
    ok(import_tm(c, s, csv_bytes([(f"match {t}", f"Treffer {t}", "de")])), 201)
    return s, t, names


def test_ai_draft_routing(app_url, wiremock):
    c = api(app_url)
    s, t, names = drafting_project(c, "draft")
    b = "dr/one"
    out = {lang: ok(c.post(f"/api/projects/{s}/branches/{enc(b)}/drafts", json={"language": lang})) for lang in ("de", "fr", "ja")}
    assert out["de"] == {"tm_reused": 1, "ai_drafted": 2} and out["fr"] == {"tm_reused": 0, "ai_drafted": 3} and out["ja"] == {"tm_reused": 0, "ai_drafted": 3}
    engines = {"de": "ivt-route-de", "fr": "ivt-route-fr", "ja": "lexa-formal"}
    calls = [j for j in journal(wiremock, "/ai/v1/draft", "POST") if t in j["body"]]
    for lang, n in (("de", 2), ("fr", 3), ("ja", 3)):
        mine = [j for j in calls if j["query"].get("target") == [lang]]
        assert len(mine) == n, (lang, mine)
        for j in mine:
            body = json.loads(j["body"])
            assert j["query"]["engine"] == [engines[lang]] and j["query"]["source"] == ["en"]
            assert names[body["key"]] == body["text"] and (lang != "de" or body["key"] != f"ivt.a{t}")
    tm_seg = segment(c, seg_id(c, s, f"ivt.a{t}", "de", b))
    assert (tm_seg["value"], tm_seg["origin"], tm_seg["status"], tm_seg["score"]) == (f"Treffer {t}", "tm", "drafted", None)
    for lang in ("de", "fr", "ja"):
        for n in (f"ivt.b{t}", f"ivt.c{t}"):
            sg = segment(c, seg_id(c, s, n, lang, b))
            issues = [dict(category=a, severity=b_, note=x) for a, b_, x in AI_ISSUE[lang]]
            want = mqm(issues, names[n])
            assert (sg["value"], sg["origin"], sg["score"]) == (AI_DRAFT[lang], f"ai:{engines[lang]}", want)
            assert sg["status"] == ("scored" if want >= DEFAULT_THRESHOLD else "needs_review")
            assert [(i["category"], i["severity"], i["note"]) for i in sg["issues"]] == AI_ISSUE[lang]
            tos = [h["to"] for h in sg["history"]]
            assert "drafted" in tos and tos.index("drafted") < tos.index(sg["status"])
    assert ok(c.post(f"/api/projects/{s}/branches/{enc(b)}/drafts", json={"language": "de"})) == {"tm_reused": 0, "ai_drafted": 0}
    ok(move(c, s, b, "in_review"))
    rejects(c.post(f"/api/projects/{s}/branches/{enc(b)}/drafts", json={"language": "de"}), 409, "branch_not_open")


def test_wf_drafting_happy(browser, app_url):
    c = api(app_url)
    s, t, names = drafting_project(c, "drui")
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("region", name="Workflows").get_by_role("button", name="Draft with AI"), "Draft with AI"))
        dlg = show(page, page.get_by_role("dialog", name="Draft with AI"), "Draft with AI dialog")
        select(dlg.get_by_role("combobox", name="Branch"), "dr/one")
        select(dlg.get_by_role("combobox", name="Language"), "de")
        click(dlg.get_by_role("button", name="Draft"))
        reads(page, updates(page), "Drafted 2 segments with AI and reused 1 exact matches.", "draft success copy")
    origins = sorted(segment(c, seg_id(c, s, n, "de", "dr/one"))["origin"] for n in names)
    assert origins == ["ai:ivt-route-de", "ai:ivt-route-de", "tm"]


MQM_CASES = [
    ("Welcome back, {name}.", [MAJOR]),
    (" ".join(f"w{i}" for i in range(40)), [MINOR, MINOR, MINOR]),
    (" ".join(f"w{i}" for i in range(12)), [CRITICAL]),
    (" ".join(f"w{i}" for i in range(20)), [MAJOR, MINOR]),
    ("Tap {x} now", []),
    (" ".join(f"w{i}" for i in range(10)), [MINOR]),
]


def test_mqm_scoring_and_states(app_url):
    c = api(app_url)
    s = project(c, "mqm")["slug"]
    for i, (source, issues) in enumerate(MQM_CASES):
        add_key(c, s, f"ivt.m{i}", source)
        sid = seg_id(c, s, f"ivt.m{i}", "de")
        set_value(c, sid, "Wert")
        sg = score(c, sid, issues)
        want = mqm(issues, source)
        assert sg["score"] == want and sg["status"] == ("scored" if want >= DEFAULT_THRESHOLD else "needs_review"), (source, issues, sg)
        assert segment(c, sid)["score"] == want
    assert mqm([MAJOR], "Welcome back, {name}.") == 50
    sid = seg_id(c, s, f"ivt.m{len(MQM_CASES) - 1}", "de")
    sg = ok(c.post(f"/api/segments/{sid}/issues", json=MAJOR), 201)
    assert len(sg["issues"]) == 2 and sg["status"] == "needs_review" and sg["score"] == mqm([MINOR, MAJOR], MQM_CASES[-1][0])

    add_key(c, s, "ivt.flow", "Flow key")
    f = seg_id(c, s, "ivt.flow", "de")
    assert rejects(c.post(f"/api/segments/{f}/approve", json={}), 409, "illegal_transition")["details"] == {"from": "untranslated", "to": "approved"}
    rejects(c.post(f"/api/segments/{f}/score", json={"issues": []}), 409, "illegal_transition")
    set_value(c, f, "Fluss")
    rejects(c.post(f"/api/segments/{f}/approve", json={}), 409, "illegal_transition")
    rejects(c.post(f"/api/segments/{f}/correct", json={"value": "x"}), 409, "illegal_transition")
    rejects(c.post(f"/api/segments/{f}/score", json={"issues": [{"category": "tone", "severity": "minor"}]}), 422, "validation_failed")
    assert score(c, f)["status"] == "scored"
    rejects(c.post(f"/api/segments/{f}/correct", json={"value": "x"}), 409, "illegal_transition")
    a = approve(c, f)
    assert a["status"] == "approved" and a["score"] == MQM_FULL
    rejects(c.post(f"/api/segments/{f}/score", json={"issues": []}), 409, "illegal_transition")
    rejects(c.post(f"/api/segments/{f}/issues", json=MINOR), 409, "illegal_transition")
    d = set_value(c, f, "Neu")
    assert (d["status"], d["score"], d["issues"]) == ("drafted", None, [])
    make_needs_review(c, f, "Wieder")
    fix_value, fix_note = f"Korrekt {tag('fx')}", f"Fixed {tag('fx')}"
    cr = ok(c.post(f"/api/segments/{f}/correct", json={"value": fix_value, "comment": fix_note}))
    assert (cr["status"], cr["value"], cr["origin"]) == ("approved", fix_value, "review") and cr["issues"] and cr["comments"][-1]["body"] == fix_note


def test_ai_outage(app_url):
    down = instance("APP_AI_DOWN_URL")
    c = api(app_url)
    s, t, names = drafting_project(c, "aiout")
    d = api(down)
    assert ok(d.get("/api/integrations"))["ai_engine"] == "down"
    assert ok(c.get("/api/integrations"))["ai_engine"] == "up"
    e = rejects(d.post(f"/api/projects/{s}/branches/{enc('dr/one')}/drafts", json={"language": "de"}), 503, "ai_engine_unavailable")
    assert e["details"] == {"tm_reused": 1, "ai_drafted": 0}
    statuses = {n: segment(c, seg_id(c, s, n, "de", "dr/one")) for n in names}
    assert (statuses[f"ivt.a{t}"]["origin"], statuses[f"ivt.a{t}"]["status"]) == ("tm", "drafted")
    assert all(statuses[n]["status"] == "untranslated" for n in names if n != f"ivt.a{t}")


def test_wf_drafting_outage(browser, app_url):
    down = instance("APP_AI_DOWN_URL")
    c = api(app_url)
    s, t, _ = drafting_project(c, "aiui")
    with browse(browser, down, f"/projects/{s}", who=api(down)) as page:
        status = page.get_by_role("region", name="Service status")
        reads(page, status, lambda x: BANNER_AI[0] in x and BANNER_AI[1] in x, "AI engine outage banner")
        click(page.get_by_role("region", name="Workflows").get_by_role("button", name="Draft with AI"))
        dlg = show(page, page.get_by_role("dialog", name="Draft with AI"), "Draft with AI dialog")
        select(dlg.get_by_role("combobox", name="Branch"), "dr/one")
        select(dlg.get_by_role("combobox", name="Language"), "de")
        click(dlg.get_by_role("button", name="Draft"))
        reads(page, problems(page), BANNER_AI[1], "503 draft copy")
    with browse(browser, app_url, "/desk", who=c) as page:
        show(page, page.get_by_role("heading", name="Your desk", exact=True), "dashboard")
        assert BANNER_AI[0] not in page.get_by_role("region", name="Service status").inner_text()
    assert segment(c, seg_id(c, s, f"ivt.a{t}", "de", "dr/one"))["origin"] == "tm"


def test_reviewer_invitations_and_scope(app_url):
    c = api(app_url)
    a, b, x = (project(c, n)["slug"] for n in ("rva", "rvb", "rvx"))
    name, email = person("scope")
    first = ok(c.post(f"/api/projects/{a}/reviewers", json={"name": name, "email": email}), 201)
    assert ACCESS_KEY_RE.match(first["access_key"])
    listed = ok(c.get(f"/api/projects/{a}/reviewers"))["reviewers"]
    assert [r["email"] for r in listed] == [email] and "access_key" not in listed[0]
    rejects(c.post(f"/api/projects/{a}/reviewers", json={"name": name, "email": email}), 409, "reviewer_exists")
    second = ok(c.post(f"/api/projects/{b}/reviewers", json={"name": name, "email": email}), 200)
    assert second["access_key"] is None and second["id"] == first["id"]
    rv = api(app_url, email, first["access_key"])
    assert ok(rv.get("/api/me")).get("user", ok(rv.get("/api/me")))["role"] == "reviewer"
    assert sorted(p["slug"] for p in ok(rv.get("/api/projects"))["projects"]) == sorted([a, b])
    rejects(rv.get(f"/api/projects/{x}"), 404, "not_found")
    for n in ("ivt.s1", "ivt.s2"):
        add_key(c, a, n, f"Scope {n}")
    s1, s2 = seg_id(c, a, "ivt.s1", "de"), seg_id(c, a, "ivt.s2", "de")
    make_needs_review(c, s1, "Eins")
    ok(assign(c, a, first["id"]), 201)
    make_needs_review(c, s2, "Zwei")
    r = rv.post(f"/api/segments/{s2}/approve", json={})
    assert r.status_code in (403, 404), r.text
    rejects(rv.get(f"/api/segments/{s2}"), 404, "not_found")
    assert segment(c, s2)["status"] == "needs_review"
    ok(rv.post(f"/api/segments/{s1}/comments", json={"body": "Looks fine"}), 201)
    assert approve(rv, s1)["status"] == "approved"
    rejects(rv.post(f"/api/projects/{a}/reviewers", json={"name": "x", "email": "x@interline.example"}), 403, "forbidden")
    add_key(c, b, "ivt.bx", "Bee")
    make_needs_review(c, seg_id(c, b, "ivt.bx", "de"), "Biene")
    asg = ok(assign(c, b, first["id"]), 201)
    ok(c.delete(f"/api/projects/{b}/reviewers/{first['id']}"), 204)
    assert [p["slug"] for p in ok(rv.get("/api/projects"))["projects"]] == [a]
    assert {z["id"]: z for z in ok(c.get(f"/api/projects/{b}/assignments"))["assignments"]}[asg["id"]]["state"] == "cancelled"


def review_setup(c, slug, names, lang="de", b="main"):
    sids = []
    for n in names:
        if key_named(c, slug, n, b) is None:
            add_key(c, slug, n, f"Review {n}", b)
        sid = seg_id(c, slug, n, lang, b)
        make_needs_review(c, sid, f"Wert {n}")
        sids.append(sid)
    return sids


def test_assignment_completion_and_event(app_url, svix):
    c = api(app_url)
    p = project(c, "asg", targets=("de", "fr"))
    s = p["slug"]
    ok(c.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL}))
    rid, email, key, _ = invite(c, s)
    review_setup(c, s, ["ivt.f1", "ivt.f2"], "fr")
    race = together([lambda: assign(c, s, rid, "fr"), lambda: assign(api(app_url), s, rid, "fr")])
    assert sorted(r.status_code for r in race) == [201, 409]
    assert err(next(r for r in race if r.status_code == 409)) == "no_segments_to_review"
    sids = review_setup(c, s, ["ivt.d1", "ivt.d2"], "de")
    asg = ok(assign(c, s, rid, "de"), 201)
    assert sorted(asg["segment_ids"]) == sorted(sids) and asg["state"] == "active" and asg["expires_at"]
    rejects(assign(c, s, rid, "de"), 409, "no_segments_to_review")
    rv = api(app_url, email, key)
    approve(rv, sids[0])
    assert {z["id"]: z for z in ok(c.get(f"/api/projects/{s}/assignments"))["assignments"]}[asg["id"]]["state"] == "active"
    ok(rv.post(f"/api/segments/{sids[1]}/correct", json={"value": "Besser", "comment": "Tone"}))
    assert {z["id"]: z for z in ok(c.get(f"/api/projects/{s}/assignments"))["assignments"]}[asg["id"]]["state"] == "completed"
    assert all(segment(c, x)["status"] == "approved" for x in sids)
    eid = f"evt_rev_{asg['id']}"
    uid = f"idk-{p['id']}"
    msgs = poll(lambda: [m for m in svix.messages(uid, "review.completed") if m.get("eventId") == eid], bool, UI_WAIT_S, f"Svix holds {eid}")
    assert len(msgs) == 1
    pl = msgs[0]["payload"]
    assert (pl["event_id"], pl["type"], pl["project"], pl["branch"], pl["language"], pl["assignment_id"], pl["reviewer_id"], pl["segments_approved"]) == (eid, "review.completed", s, "main", "de", asg["id"], rid, 2) and pl["completed_at"]


def test_assignment_expiry():
    base = instance("APP_SHORT_URL")
    c = api(base)
    s = project(c, "aexp")["slug"]
    rid, email, key, _ = invite(c, s)
    sids = review_setup(c, s, ["ivt.x1"])
    asg = ok(assign(c, s, rid), 201)
    poll(lambda: {z["id"]: z for z in ok(c.get(f"/api/projects/{s}/assignments"))["assignments"]}[asg["id"]]["state"], lambda st: st == "expired", SHORT_WAIT_S, "the assignment reads expired after expires_at")
    rv = api(base, email, key)
    rejects(rv.post(f"/api/segments/{sids[0]}/approve", json={}), 409, "assignment_expired")
    assert segment(c, sids[0])["status"] == "needs_review"
    assert not [x for x in ok(rv.get("/api/review-queue"))["segments"] if x["segment_id"] == sids[0]]
    assert ok(assign(c, s, rid), 201)["segment_ids"] == sids


def test_wf_review_expired(browser):
    base = instance("APP_SHORT_URL")
    c = api(base)
    s = project(c, "aexpui")["slug"]
    rid, email, key, _ = invite(c, s)
    kname = "ivt.y1"
    lang = "de"
    review_setup(c, s, [kname])
    rv = api(base, email, key)
    with browse(browser, base, "/review", who=rv) as page:
        refresh = show(page, page.get_by_role("button", name="Refresh queue"), "Refresh queue")
        asg = ok(assign(c, s, rid), 201)
        click(refresh)
        card = show(page, page.get_by_role("article", name=f"{kname} ({lang})"), "the assigned card")
        poll(lambda: {z["id"]: z for z in ok(c.get(f"/api/projects/{s}/assignments"))["assignments"]}[asg["id"]]["state"], lambda st: st == "expired", SHORT_WAIT_S, "assignment expired")
        click(card.get_by_role("button", name="Approve"))
        reads(page, problems(page), "This assignment expired. Ask the engineer to assign it again.", "assignment_expired copy")
        click(page.get_by_role("button", name="Refresh queue").first)
        show(page, page.get_by_role("heading", name="Nothing to review right now", exact=True), "empty queue after refresh")


def check_dialog(page, opener, dialog_name, first):
    opener.focus()
    page.keyboard.press("Enter")
    dlg = show(page, page.get_by_role("dialog", name=dialog_name), f"dialog {dialog_name}")
    expect(first).to_be_focused()
    page.keyboard.press("Shift+Tab")
    assert inside(dlg), f"Shift+Tab from the first control of {dialog_name} wraps inside"
    page.keyboard.press("Tab")
    expect(first).to_be_focused()
    for _ in range(12):
        page.keyboard.press("Tab")
        assert inside(dlg), f"Tab stays inside {dialog_name}"
    page.keyboard.press("Escape")
    gone(page, page.get_by_role("dialog", name=dialog_name), f"Escape closes {dialog_name}")
    expect(opener).to_be_focused()
    return dlg


def test_review_queue_keyboard(browser, app_url):
    c = api(app_url)
    s = project(c, "kbd")["slug"]
    names = ["ivt.q1", "ivt.q2", "ivt.q3"]
    sids = dict(zip(names, review_setup(c, s, names)))
    rid, email, key, _ = invite(c, s)
    ok(assign(c, s, rid), 201)
    rv = api(app_url, email, key)
    with browse(browser, app_url, "/review", who=rv) as page:
        show(page, page.get_by_text("Shortcuts: J next, K previous, A approve, C correct.", exact=True), "shortcut line")
        queue = page.get_by_role("region", name="Review queue")
        cards = [show(page, queue.get_by_role("article", name=f"{n} (de)"), n) for n in names]
        order = sorted(zip(names, cards), key=lambda nc: box(nc[1])["y"])
        (n1, c1), (n2, c2) = order[0], order[1]
        expect(c1).to_have_attribute("aria-current", "true")
        c1.get_by_role("button", name="Approve").focus()
        page.keyboard.press("j")
        expect(c2).to_have_attribute("aria-current", "true")
        expect(c2.get_by_role("button", name="Approve")).to_be_focused()
        page.keyboard.press("K")
        expect(c1).to_have_attribute("aria-current", "true")
        expect(c1.get_by_role("button", name="Approve")).to_be_focused()
        c1.get_by_role("button", name="Correct").focus()
        page.keyboard.press("j")
        expect(c2).to_have_attribute("aria-current", "true")
        page.keyboard.press("a")
        reads(page, c2, "Approved", "A approves the current card")
        poll(lambda: segment(c, sids[n2])["status"], lambda st: st == "approved", UI_WAIT_S, "A approved on the server")
        c1.get_by_role("button", name="Correct").focus()
        page.keyboard.press("k")
        expect(c1).to_have_attribute("aria-current", "true")
        page.keyboard.press("c")
        dlg = show(page, page.get_by_role("dialog", name="Correct segment"), "Correct segment dialog")
        box_ = dlg.get_by_role("textbox", name="Corrected translation")
        expect(box_).to_be_focused()
        page.keyboard.press("End")
        page.keyboard.press("j")
        assert box_.input_value().endswith("j") and c1.get_attribute("aria-current") == "true", "shortcuts are off inside a text box"
        page.keyboard.press("Shift+Tab")
        assert inside(dlg)
        page.keyboard.press("Tab")
        expect(box_).to_be_focused()
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Correct segment"), "Escape closes Correct segment")
        expect(c1.get_by_role("button", name="Correct")).to_be_focused()
        page.keyboard.press("c")
        dlg = show(page, page.get_by_role("dialog", name="Correct segment"), "Correct segment dialog")
        fix_value, fix_note = f"Korrigiert kbd {tag('kb')}", f"Keyboard fix {tag('kb')}"
        fill(dlg.get_by_role("textbox", name="Corrected translation"), fix_value)
        fill(dlg.get_by_role("textbox", name="Comment"), fix_note)
        click(dlg.get_by_role("button", name="Save correction"))
        reads(page, updates(page), "Correction saved and approved.", "correction copy")
        expect(c1.get_by_role("button", name="Correct")).to_be_focused()
    one = segment(c, sids[n1])
    assert (one["status"], one["value"], one["origin"]) == ("approved", fix_value, "review") and one["comments"][-1]["body"] == fix_note
    third = [n for n in names if n not in (n1, n2)][0]
    assert segment(c, sids[third])["status"] == "needs_review"


def test_dialogs_keyboard(browser, app_url):
    c = api(app_url)
    s = project(c, "dlg")["slug"]
    branch(c, s, "dlg/one")
    add_key(c, s, "ivt.d", "Dialog key")
    sid = seg_id(c, s, "ivt.d", "de")
    set_value(c, sid, "Dialog")
    with browse(browser, app_url, "/desk", who=c) as page:
        opener = show(page, page.get_by_role("button", name="New project"), "New project")
        dlg = page.get_by_role("dialog", name="New project")
        check_dialog(page, opener, "New project", dlg.get_by_role("textbox", name="Slug"))
        page.goto(f"{app_url}/projects/{s}")
        opener = show(page, page.get_by_role("button", name="New branch"), "New branch")
        dlg = page.get_by_role("dialog", name="New branch")
        check_dialog(page, opener, "New branch", dlg.get_by_role("textbox", name="Branch name"))
        opener.focus()
        page.keyboard.press("Enter")
        show(page, dlg, "New branch dialog")
        fill(dlg.get_by_role("textbox", name="Branch name"), "dlg/one")
        click(dlg.get_by_role("button", name="Create branch"))
        reads(page, problems(page), "A branch with that name already exists.", "branch_exists copy")
        assert dlg.is_visible()
        expect(dlg.get_by_role("textbox", name="Branch name")).to_be_focused()
        page.keyboard.press("Escape")
        page.goto(f"{app_url}/projects/{s}/editor?branch=main&lang=de&segment={sid}")
        opener = show(page, page.get_by_role("button", name="Record MQM issue"), "Record MQM issue")
        check_dialog(page, opener, "Record MQM issue", page.get_by_role("dialog", name="Record MQM issue").get_by_role("combobox", name="Category"))
    with browse(browser, app_url, "/desk", who=c, size=(375, 812)) as page:
        opener = show(page, page.get_by_role("button", name="Open menu"), "Open menu")
        check_dialog(page, opener, "Menu", page.get_by_role("dialog", name="Menu").get_by_role("button", name="Close menu"))
    assert branch_names(c, s) == ["dlg/one", "main"]


EDITOR_SIZES = {
    "375x812": (375, 812),
    "768x1024": (768, 1024),
    "1023x800": (1023, 800),
    "1024x800": (1024, 800),
    "1280x800": (1280, 800),
}


@pytest.mark.parametrize("size", list(EDITOR_SIZES), ids=list(EDITOR_SIZES))
def test_editor_breakpoints(browser, app_url, size):
    w, h = EDITOR_SIZES[size]
    c = api(app_url)
    s = project(c, "edit")["slug"]
    add_key(c, s, "ivt.ed", "Editor key")
    sid = seg_id(c, s, "ivt.ed", "de")
    with browse(browser, app_url, f"/projects/{s}/editor?branch=main&lang=de&segment={sid}", who=c, size=(w, h)) as page:
        seg, ed, q = (show(page, page.get_by_role("region", name=n), n) for n in ("Segments", "Segment editor", "Quality and history"))
        lang = "de"
        show(page, ed.get_by_role("textbox", name=f"Translation ({lang})"), "translation box")
        bs, be, bq = (box(x) for x in (seg, ed, q))
        right = lambda b: round(b["x"] + b["width"])
        bottom = lambda b: round(b["y"] + b["height"])
        if w < 768:
            assert bottom(be) <= round(bq["y"]) and bottom(bq) <= round(bs["y"]), "one column: editor, quality, segments"
            for btn in [ed.get_by_role("textbox", name=f"Translation ({lang})")] + [ed.get_by_role("button", name=n) for n in ("Save translation", "Record MQM issue", "Score", "Approve")]:
                b = box(btn)
                assert b["x"] >= 0 and right(b) <= w
        elif w < 1024:
            assert right(bs) <= round(be["x"]) and right(bs) <= round(bq["x"]), "Segments on the left"
            assert bottom(be) <= round(bq["y"]) and bs["width"] < be["width"], "editor above quality on the right"
        else:
            assert right(bs) <= round(be["x"]) and right(be) <= round(bq["x"]), "three columns left to right"
        layout(page)


def test_wf_review_phone(browser, app_url):
    c = api(app_url)
    s = project(c, "phone")["slug"]
    k1, k2 = "ivt.p1", "ivt.p2"
    fixed = "Am Telefon korrigiert"
    lang = "de"
    sids = review_setup(c, s, [k1, k2])
    rid, email, key, _ = invite(c, s)
    asg = ok(assign(c, s, rid), 201)
    with browse(browser, app_url, "/sign-in", size=(375, 812)) as page:
        sign_in_ui(page, email, key)
        at_path(page, "/review", "a reviewer lands on the review queue")
        queue = page.get_by_role("region", name="Review queue")
        a1 = show(page, queue.get_by_role("article", name=f"{k1} ({lang})"), "card p1")
        a2 = show(page, queue.get_by_role("article", name=f"{k2} ({lang})"), "card p2")
        click(a1.get_by_role("button", name="Approve"))
        reads(page, a1, "Approved", "approved card stays listed")
        click(a2.get_by_role("button", name="Correct"))
        dlg = show(page, page.get_by_role("dialog", name="Correct segment"), "Correct segment")
        fill(dlg.get_by_role("textbox", name="Corrected translation"), fixed)
        click(dlg.get_by_role("button", name="Save correction"))
        reads(page, updates(page), "Correction saved and approved.", "correction copy")
        layout(page)
    assert [segment(c, x)["status"] for x in sids] == ["approved", "approved"]
    assert segment(c, sids[1])["value"] == fixed
    assert {z["id"]: z for z in ok(c.get(f"/api/projects/{s}/assignments"))["assignments"]}[asg["id"]]["state"] == "completed"


def publish_project(c, prefix):
    p = project(c, prefix, targets=("de", "fr", "ja"))
    s = p["slug"]
    for n, src in (("ivt.size", "Size"), ("ivt.Z", "Zulu"), ("ivt.b", "Bravo"), ("ivt.a", "Alpha")):
        add_key(c, s, n, src)
    make_approved(c, seg_id(c, s, "ivt.a", "de"), "Alpha DE")
    make_approved(c, seg_id(c, s, "ivt.size", "de"), "Größe")
    make_approved(c, seg_id(c, s, "ivt.Z", "de"), "Zulu DE")
    set_value(c, seg_id(c, s, "ivt.b", "de"), "Nur Entwurf")
    make_approved(c, seg_id(c, s, "ivt.a", "ja"), "アルファ")
    expected = {"de": bundle({"ivt.a": "Alpha DE", "ivt.size": "Größe", "ivt.Z": "Zulu DE"}), "fr": bundle({}), "ja": bundle({"ivt.a": "アルファ"})}
    return p, expected


def test_publish_confirmed_by_host(app_url, wiremock):
    c = api(app_url)
    p, expected = publish_project(c, "pub")
    s, pid = p["slug"], p["id"]
    pr_path = f"/git/v1/repos/ivt-owner/{s}/pulls/{PR_NUMBER}"
    wiremock.stub("GET", pr_path, status=404, json={"message": "Not Found"})
    first = ok(publish(c, s, new_key_header()), 202)
    assert first["state"] == "queued" and first["failure_reason"] is None
    pub = wait_publish(c, s, first["id"], ("awaiting_host_confirmation", "published", "failed"))
    assert pub["state"] == "awaiting_host_confirmation" and pub["confirmed_at"] is None
    assert sorted(pub["bundles"]) == ["de", "fr", "ja"]
    for lang, data in expected.items():
        key = f"projects/{pid}/publishes/{first['id']}/{lang}.json"
        assert pub["bundles"][lang]["object_key"] == key and S3().get(key) == data
        assert pub["bundles"][lang]["sha256"] == hashlib.sha256(data).hexdigest()
    posts = [json.loads(j["body"]) for j in journal(wiremock, f"/git/v1/repos/ivt-owner/{s}/pulls", "POST")]
    assert len(posts) == 1
    body = posts[0]
    assert (body["title"], body["head"], body["base"]) == (f"Interline Desk publish {first['id']}", f"interline/{first['id']}", "main")
    assert {f["path"]: base64.b64decode(f["content"]) for f in body["files"]} == {f"locales/{k}.json": v for k, v in expected.items()}
    wiremock.stub("GET", pr_path, status=200, json={"number": PR_NUMBER + 1, "state": "open", "merged": False})
    poll(lambda: len(journal(wiremock, pr_path, "GET")), lambda n: n >= 3, UI_WAIT_S, "the app keeps reading the pull request")
    assert ok(c.get(f"/api/projects/{s}/publishes/{first['id']}"))["state"] == "awaiting_host_confirmation"
    wiremock.stub("GET", pr_path, status=200, json={"number": PR_NUMBER, "state": "open", "merged": False})
    done = wait_publish(c, s, first["id"], ("published", "failed"))
    assert done["state"] == "published" and done["confirmed_at"] and done["pull_request"] == {"number": PR_NUMBER, "url": PR_URL}
    assert ok(c.get(f"/api/projects/{s}"))["last_publish"]["id"] == first["id"]


@pytest.mark.timeout(300)
def test_publish_rejected_and_not_confirmed(app_url, wiremock):
    c = api(app_url)
    p, _ = publish_project(c, "prej")
    wiremock.stub("POST", f"/git/v1/repos/ivt-owner/{p['slug']}/pulls", status=422, json={"message": "Validation Failed"})
    r = ok(publish(c, p["slug"], new_key_header()), 202)
    done = wait_publish(c, p["slug"], r["id"], ("published", "failed"))
    assert (done["state"], done["failure_reason"]) == ("failed", "pull_request_rejected")
    q, _ = publish_project(c, "pnot")
    wiremock.stub("GET", f"/git/v1/repos/ivt-owner/{q['slug']}/pulls/{PR_NUMBER}", status=404, json={"message": "Not Found"})
    r = ok(publish(c, q["slug"], new_key_header()), 202)
    wait_publish(c, q["slug"], r["id"], ("awaiting_host_confirmation",))
    done = wait_publish(c, q["slug"], r["id"], ("published", "failed"), CONFIRM_WINDOW_S * 3)
    assert (done["state"], done["failure_reason"], done["confirmed_at"]) == ("failed", "not_confirmed", None)


def test_publish_idempotency_and_one_at_a_time(app_url, wiremock):
    c = api(app_url)
    s = publish_project(c, "idem")[0]["slug"]
    wiremock.stub("GET", f"/git/v1/repos/ivt-owner/{s}/pulls/{PR_NUMBER}", status=500, json={})
    for headers in ({}, {"Idempotency-Key": "x" * 65}, {"Idempotency-Key": "has space"}):
        e = c.post(f"/api/projects/{s}/publishes", json={"branch": "main"}, headers=headers)
        rejects(e, 422, "validation_failed")
        assert "Idempotency-Key" in (e.json()["error"].get("fields") or {})
    k1 = new_key_header()
    first = publish(c, s, k1)
    assert first.status_code == 202
    replay = publish(c, s, k1)
    assert replay.status_code == 202 and replay.json() == first.json()
    rejects(c.post(f"/api/projects/{s}/publishes", json={"branch": "ivt/other"}, headers={"Idempotency-Key": k1}), 409, "idempotency_key_reused")
    rejects(publish(c, s, new_key_header()), 409, "publish_in_progress")
    assert len(ok(c.get(f"/api/projects/{s}/publishes"))["publishes"]) == 1
    q = publish_project(c, "idemq")[0]["slug"]
    assert publish(c, q, k1).status_code == 202, "keys are scoped per project"
    r = publish_project(c, "idemr")[0]["slug"]
    wiremock.stub("GET", f"/git/v1/repos/ivt-owner/{r}/pulls/{PR_NUMBER}", status=500, json={})
    results = together([lambda: publish(api(app_url), r, new_key_header()) for _ in range(5)])
    assert sorted(x.status_code for x in results) == [202, 409, 409, 409, 409]
    assert all(err(x) == "publish_in_progress" for x in results if x.status_code == 409)
    assert len(ok(c.get(f"/api/projects/{r}/publishes"))["publishes"]) == 1


def test_git_host_outage(browser, app_url, wiremock):
    c = api(app_url)
    p, _ = publish_project(c, "gitx")
    s = p["slug"]
    path = f"/git/v1/repos/ivt-owner/{s}/pulls"
    wiremock.stub("POST", path, status=503, json={})
    r = ok(publish(c, s, new_key_header()), 202)
    done = wait_publish(c, s, r["id"], ("published", "failed"))
    assert (done["state"], done["failure_reason"]) == ("failed", "git_host_unavailable")
    assert len(journal(wiremock, path, "POST")) == GIT_ATTEMPTS
    down = instance("APP_GIT_DOWN_URL")
    assert ok(api(down).get("/api/integrations"))["git_host"] == "down"
    _, email, key, _ = invite(c, s)
    with browse(browser, down, "/review", who=api(down, email, key)) as page:
        reads(page, page.get_by_role("region", name="Service status"), lambda t: BANNER_GIT[0] in t and BANNER_GIT[1] in t, "repository host banner for a reviewer")


def test_wf_publish_outage(browser, app_url):
    down = instance("APP_GIT_DOWN_URL")
    c = api(app_url)
    s = publish_project(c, "gitui")[0]["slug"]
    with browse(browser, down, f"/projects/{s}", who=api(down)) as page:
        reads(page, page.get_by_role("region", name="Service status"), lambda t: BANNER_GIT[0] in t and BANNER_GIT[1] in t, "repository host banner")
        click(page.get_by_role("region", name="Workflows").get_by_role("button", name="Publish", exact=True))
        dlg = show(page, page.get_by_role("dialog", name="Publish"), "Publish dialog")
        select(dlg.get_by_role("combobox", name="Branch"), "main")
        click(dlg.get_by_role("button", name="Publish to repository"))
        reads(page, page.get_by_role("region", name="Publish status"), "Publish failed: the repository host isn't answering.", "git_host_unavailable copy", PUBLISH_WAIT_S)
    last = ok(c.get(f"/api/projects/{s}/publishes"))["publishes"][0]
    assert (last["state"], last["failure_reason"]) == ("failed", "git_host_unavailable")


def test_wf_publish_happy(browser, app_url, wiremock):
    c = api(app_url)
    p, expected = publish_project(c, "pubui")
    s = p["slug"]
    pr_path = f"/git/v1/repos/ivt-owner/{s}/pulls/{PR_NUMBER}"
    wiremock.stub("GET", pr_path, status=404, json={"message": "Not Found"})
    with browse(browser, app_url, f"/projects/{s}", who=c) as page:
        click(show(page, page.get_by_role("region", name="Workflows").get_by_role("button", name="Publish", exact=True), "Publish"))
        dlg = show(page, page.get_by_role("dialog", name="Publish"), "Publish dialog")
        select(dlg.get_by_role("combobox", name="Branch"), "main")
        click(dlg.get_by_role("button", name="Publish to repository"))
        status = page.get_by_role("region", name="Publish status")
        reads(page, status, "Awaiting host confirmation", "awaiting state shown", PUBLISH_WAIT_S)
        assert "Published as pull request" not in status.inner_text()
        wiremock.stub("GET", pr_path, status=200, json={"number": PR_NUMBER, "state": "open", "merged": False})
        reads(page, status, f"Published as pull request #{PR_NUMBER}.", "published copy", PUBLISH_WAIT_S)
        page.goto(f"{app_url}/projects/{s}?branch=main")
        reads(page, page.get_by_role("tabpanel", name="main"), f"Pull request #{PR_NUMBER}", "last publish on the main panel")
    last = ok(c.get(f"/api/projects/{s}/publishes"))["publishes"][0]
    assert last["state"] == "published" and S3().get(last["bundles"]["de"]["object_key"]) == expected["de"]


def test_ci_tokens_and_locale_pull(app_url):
    c = api(app_url)
    p, expected = publish_project(c, "ci")
    s = p["slug"]
    branch(c, s, "ci/side")
    make_approved(c, seg_id(c, s, "ivt.b", "fr", "ci/side"), "Branche seulement")
    t = ok(c.post(f"/api/projects/{s}/tokens", json={"label": "ci main"}), 201)
    assert t["token"].startswith("idk_")
    listing = c.get(f"/api/projects/{s}/tokens")
    assert t["token"] not in listing.text and [x["label"] for x in listing.json()["tokens"]] == ["ci main"]
    auth = {"Authorization": f"Bearer {t['token']}"}
    for lang, data in expected.items():
        r = httpx.get(f"{app_url}/api/ci/projects/{s}/locales/{lang}.json", headers=auth, timeout=REQUEST_TIMEOUT_S)
        assert r.status_code == 200 and r.content == data, (lang, r.content)
        assert r.headers["content-type"].lower() == "application/json; charset=utf-8"
    other = project(c, "ci2")["slug"]
    rejects(httpx.get(f"{app_url}/api/ci/projects/{other}/locales/de.json", headers=auth, timeout=REQUEST_TIMEOUT_S), 404, "not_found")
    rejects(c.get(f"/api/ci/projects/{s}/locales/de.json"), 401, "unauthenticated")
    rejects(httpx.get(f"{app_url}/api/projects/{s}", headers=auth, timeout=REQUEST_TIMEOUT_S), 401, "unauthenticated")
    ok(c.delete(f"/api/projects/{s}/tokens/{t['id']}"), 204)
    rejects(httpx.get(f"{app_url}/api/ci/projects/{s}/locales/de.json", headers=auth, timeout=REQUEST_TIMEOUT_S), 401, "unauthenticated")


def test_wf_ci_delivery_token(browser, app_url):
    c = api(app_url)
    p, expected = publish_project(c, "ciui")
    with browse(browser, app_url, f"/projects/{p['slug']}/settings", who=c) as page:
        fill(show(page, page.get_by_role("textbox", name="Token label"), "Token label"), "pipeline")
        click(page.get_by_role("button", name="Create token"))
        reads(page, updates(page), "Token created. Copy it now; it won't be shown again.", "token copy")
        text = reads(page, page.get_by_role("region", name="New token"), "idk_", "the new token shown once")
    token = re.search(r"idk_\S+", text).group(0)
    r = httpx.get(f"{app_url}/api/ci/projects/{p['slug']}/locales/de.json", headers={"Authorization": f"Bearer {token}"}, timeout=REQUEST_TIMEOUT_S)
    assert r.status_code == 200 and r.content == expected["de"]


def test_signed_webhook_events(app_url, svix):
    c = api(app_url)
    p, expected = publish_project(c, "hook")
    s, uid = p["slug"], f"idk-{p['id']}"
    w = ok(c.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL}))
    assert w["url"] == SINK_URL and sorted(w["event_types"]) == ["locale.published", "review.completed"] and w["signing_secret"]
    ok(c.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL}))
    apps = svix_app(svix, p["id"])
    assert len(apps) == 1 and apps[0].get("name") in (p["name"], s)
    eps = [e for e in svix.endpoints(uid) if e.get("url") == SINK_URL]
    assert len(eps) == 1 and {"locale.published", "review.completed"} <= set(eps[0].get("filterTypes") or [])
    r = ok(publish(c, s, new_key_header()), 202)
    done = wait_publish(c, s, r["id"], ("published", "failed"))
    assert done["state"] == "published"
    eid = f"evt_pub_{r['id']}"
    msgs = poll(lambda: [m for m in svix.messages(uid, "locale.published") if m.get("eventId") == eid], bool, UI_WAIT_S, f"Svix holds {eid}")
    assert len(msgs) == 1
    pl = msgs[0]["payload"]
    assert (pl["event_id"], pl["type"], pl["project"], pl["branch"], pl["publish_id"]) == (eid, "locale.published", s, "main", r["id"])
    assert pl["pull_request"] == {"number": PR_NUMBER, "url": PR_URL} and sorted(pl["languages"]) == ["de", "fr", "ja"] and pl["published_at"]
    assert pl["bundles"] == {k: hashlib.sha256(v).hexdigest() for k, v in expected.items()}
    ev = poll(lambda: [e for e in ok(c.get(f"/api/projects/{s}/events"))["events"] if e["event_id"] == eid], lambda x: x and x[0]["state"] == "sent", UI_WAIT_S, "the event reads sent once Svix accepts")
    assert ev[0]["type"] == "locale.published" and ev[0]["attempts"] >= 1
    poll(lambda: svix.attempts(uid, msgs[0]["id"]), bool, UI_WAIT_S * 2, "Svix attempts delivery to the CI endpoint")
    assert len([m for m in svix.messages(uid) if m.get("eventId") == eid]) == 1


def test_wf_ci_delivery_webhook(browser, app_url, svix):
    c = api(app_url)
    p = project(c, "hookui")
    with browse(browser, app_url, f"/projects/{p['slug']}/settings", who=c) as page:
        fill(show(page, page.get_by_role("textbox", name="Endpoint URL"), "Endpoint URL"), SINK_URL)
        click(page.get_by_role("button", name="Save endpoint"))
        reads(page, updates(page), "Webhook endpoint saved.", "endpoint copy")
        show(page, page.get_by_text("Signing secret"), "Signing secret")
    assert [e for e in svix.endpoints(f"idk-{p['id']}") if e.get("url") == SINK_URL]


@pytest.mark.timeout(300)
def test_webhook_outage(browser, app_url, svix):
    down = instance("APP_SVIX_DOWN_URL")
    c = api(app_url)
    p, _ = publish_project(c, "hookx")
    s, uid = p["slug"], f"idk-{p['id']}"
    ok(c.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL}))
    d = api(down)
    assert ok(d.get("/api/integrations"))["webhooks"] == "down"
    rejects(d.put(f"/api/projects/{s}/webhook", json={"url": SINK_URL_2}), 503, "webhooks_unavailable")
    assert ok(c.get(f"/api/projects/{s}/webhook"))["url"] == SINK_URL
    r = ok(publish(d, s, new_key_header()), 202)
    assert wait_publish(d, s, r["id"], ("published", "failed"))["state"] == "published"
    eid = f"evt_pub_{r['id']}"
    ev = poll(lambda: [e for e in ok(d.get(f"/api/projects/{s}/events"))["events"] if e["event_id"] == eid], lambda x: x and x[0]["attempts"] >= 2, WEBHOOK_RETRY_S * 6, "the pending event is retried on WEBHOOK_RETRY_SECONDS")
    assert len(ev) == 1 and ev[0]["state"] == "pending" and ev[0]["sent_at"] is None
    assert not [m for m in svix.messages(uid) if m.get("eventId") == eid]
    with browse(browser, down, "/desk", who=d) as page:
        reads(page, page.get_by_role("region", name="Service status"), lambda t: BANNER_HOOK[0] in t and BANNER_HOOK[1] in t, "webhook outage banner")
        page.goto(f"{down}/projects/{s}/settings")
        fill(show(page, page.get_by_role("textbox", name="Endpoint URL"), "Endpoint URL"), SINK_URL_2)
        click(page.get_by_role("button", name="Save endpoint"))
        reads(page, problems(page), "The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.", "503 endpoint copy")


@pytest.mark.timeout(300)
def test_health_and_port(app_url):
    r = httpx.get(app_url + "/api/health", timeout=REQUEST_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["content-type"].startswith("application/json")
    with app_copy() as (base, proc, tail):
        got = wait_health(base, proc, tail)
        assert got.json() == {"status": "ok"}, tail()


def test_server_boundary(browser, app_url):
    c = api(app_url)
    s = project(c, "bound")["slug"]
    core = b'{"name":"ivt.limit","source":"Limit"}'
    exact = core + b" " * (JSON_LIMIT - len(core))
    assert ok(c.post(f"/api/projects/{s}/branches/main/keys", content=exact, headers={"Content-Type": "application/json"}), 201)
    over = b'{"name":"ivt.over","source":"Over"}' + b" " * (JSON_LIMIT + 1 - len(b'{"name":"ivt.over","source":"Over"}'))
    rejects(c.post(f"/api/projects/{s}/branches/main/keys", content=over, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    assert key_named(c, s, "ivt.over") is None
    rejects(c.post(f"/api/projects/{s}/branches/main/keys", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    rejects(c.post(f"/api/projects/{s}/tm/imports", json={"format": "csv"}), 415, "unsupported_media_type")
    manifest = (Path(DEPLOYED_APP) / "run.json").read_text()
    for path in ("/run.json", "/go.mod", "/go.sum", "/main.go", "/package-lock.json", "/.env", "/.git/config", "/src/main.ts"):
        r = httpx.get(app_url + path, timeout=REQUEST_TIMEOUT_S)
        assert r.status_code == 404 and manifest not in r.text, path
    home = httpx.get(app_url + "/", timeout=REQUEST_TIMEOUT_S).text
    for src in re.findall(r'<script[^>]+src="([^"]+)"', home):
        assert httpx.get(urljoin(app_url + "/", src) + ".map", timeout=REQUEST_TIMEOUT_S).status_code == 404, src
    evil = "http://evil.example"
    for r in (httpx.get(app_url + "/api/health", headers={"Origin": evil}, timeout=REQUEST_TIMEOUT_S), httpx.options(app_url + "/api/projects", headers={"Origin": evil, "Access-Control-Request-Method": "POST"}, timeout=REQUEST_TIMEOUT_S)):
        assert r.headers.get("access-control-allow-origin") not in ("*", evil)
    rejects(c.get(f"/api/{fresh('nowhere')}"), 404, "not_found")
    seen = []
    with browse(browser, app_url, "/desk", who=c) as page:
        page.on("request", lambda req: seen.append(req.url))
        page.goto(app_url + "/")
        show(page, page.get_by_role("heading", level=1), "landing")
        page.goto(f"{app_url}/projects/{s}")
        show(page, page.get_by_role("tablist", name="Branches"), "project page")
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign


@pytest.mark.timeout(600)
def test_boot_with_dependencies_down(app_url):
    for env in ("APP_GIT_DOWN_URL", "APP_AI_DOWN_URL", "APP_SVIX_DOWN_URL"):
        base = instance(env)
        assert httpx.get(base + "/api/health", timeout=REQUEST_TIMEOUT_S).json() == {"status": "ok"}
        assert httpx.get(base + "/", timeout=REQUEST_TIMEOUT_S).status_code == 200
    c = api(app_url)
    s = project(c, "minio")["slug"]
    branch(c, s, "mn/one")
    with app_copy(S3_ENDPOINT="http://127.0.0.1:9") as (base, proc, tail):
        wait_health(base, proc, tail)
        assert httpx.get(base + "/", timeout=REQUEST_TIMEOUT_S).status_code == 200, tail()
        m = api(base)
        rejects(import_tm(m, s, csv_bytes([("Stored", "Gespeichert", "de")])), 503, "storage_unavailable")
        rejects(upload_source(m, s, "mn/one", b'{"ivt.k": "K"}'), 503, "storage_unavailable")
    assert tm_entries(c, s)["total"] == 0 and ok(c.get(f"/api/projects/{s}/tm/imports"))["imports"] == []
    assert keys(c, s, "mn/one") == [] and operations(c, s) == []
    with app_copy(DATABASE_URL="postgres://ivt:ivt@127.0.0.1:9/ivt") as (base, proc, tail):
        r = poll(lambda: _maybe_get(base + "/api/health"), lambda x: x is not None, HEALTH_WITHIN_S, f"the server answers while Postgres is down; log:\n{tail()}")
        assert r.status_code == 503 and r.json() == {"status": "starting"}, tail()


def _maybe_get(url):
    with contextlib.suppress(httpx.HTTPError):
        return httpx.get(url, timeout=REQUEST_TIMEOUT_S)
    return None


def landing_checks(page, width):
    h1 = show(page, page.get_by_role("heading", level=1), "hero heading")
    for line in HERO_LINES:
        assert line in h1.inner_text()
    show(page, page.get_by_text(HERO_LEAD, exact=True), "hero lead")
    img = show(page, page.get_by_role("img", name=HERO_IMG), "hero locale-file collage")
    for chip in HERO_CHIPS:
        show(page, page.get_by_text(chip), f"stat chip {chip}")
    persona = page.get_by_role("region", name="Who works here")
    t1 = show(page, persona.get_by_text("The engineer's desk", exact=True), "persona one")
    t2 = show(page, persona.get_by_text("The client reviewer's queue", exact=True), "persona two")
    posture = page.get_by_role("region", name="Security and hosting")
    show(page, posture.get_by_text("How your clients' strings are kept"), "posture heading")
    items = [show(page, posture.get_by_text(t, exact=True), t) for t in POSTURE_TITLES]
    show(page, posture.get_by_role("link", name="Open the demo desk"), "posture grid button")
    hb, h1b, b1, b2 = box(img), box(h1), box(t1), box(t2)
    if width < 768:
        assert hb["y"] >= h1b["y"] + h1b["height"] and hb["width"] <= width, "the panel moves below the copy"
        assert b2["y"] > b1["y"] + b1["height"], "persona cards stack"
    else:
        assert b2["x"] > b1["x"] + b1["width"], "persona cards sit side by side"
    if width >= 1024:
        assert hb["x"] >= h1b["x"] + h1b["width"] / 2 and hb["y"] < h1b["y"] + h1b["height"], "hero split: illustration on the right"
    return columns(items)


def notice_checks(page, width, height):
    notice = show(page, page.get_by_role("region", name="Cookie and data notice"), "cookie and data notice")
    assert NOTICE_TEXT in notice.inner_text()
    nb = box(notice)
    assert round(nb["y"] + nb["height"]) <= height
    if width < 768:
        assert round(nb["width"]) >= width - 1 and round(nb["y"] + nb["height"]) >= height - 1, "full-width bottom sheet"
    else:
        assert nb["x"] < width / 2 and nb["width"] < width and nb["y"] > height / 2, "pinned bottom-left"
    click(notice.get_by_role("button", name="Details"))
    reads(page, notice, NOTICE_MORE, "Details reveals one more sentence")
    click(notice.get_by_role("button", name="Got it"))
    gone(page, notice, "Got it hides the notice")
    page.reload()
    show(page, page.get_by_role("heading", level=1), "landing after reload")
    assert page.get_by_role("region", name="Cookie and data notice").count() == 0 or not page.get_by_role("region", name="Cookie and data notice").is_visible()


def workflow_columns(page):
    region = page.get_by_role("region", name="Workflows")
    return columns([show(page, region.get_by_role("button", name=n, exact=True), n) for n in WORKFLOW_BUTTONS])


def test_wf_cross_cutting_desktop_shell(browser, app_url):
    c = api(app_url)
    p = project(c, "hdr", targets=("de", "fr"))
    s = p["slug"]
    with browse(browser, app_url, "/", keep_notice=True) as page:
        show(page, page.get_by_role("link", name="Sign in"), "header Sign in")
        assert page.get_by_role("link", name="Open the demo desk").count() >= 3
        assert landing_checks(page, 1280) == 3
        notice_checks(page, 1280, 800)
        layout(page)
    with browse(browser, app_url, "/desk", who=c) as page:
        show(page, page.get_by_role("heading", name="Your desk", exact=True), "dashboard")
        btns = {n: page.get_by_role("button", name=n, exact=True) for n in ("Projects", "Branches", "Review", "Workspace")}
        for b in btns.values():
            expect(b).to_have_attribute("aria-expanded", "false")
        btns["Projects"].focus()
        page.keyboard.press("Enter")
        expect(btns["Projects"]).to_have_attribute("aria-expanded", "true")
        nav = show(page, page.get_by_role("navigation", name="Projects"), "Projects dropdown")
        show(page, nav.get_by_role("link", name=p["name"]), "project link")
        assert p["client"] in nav.inner_text()
        page.keyboard.press("ArrowDown")
        assert nav.evaluate("n => n.contains(document.activeElement) && document.activeElement.tagName === 'A'")
        page.keyboard.press("Escape")
        expect(btns["Projects"]).to_have_attribute("aria-expanded", "false")
        expect(btns["Projects"]).to_be_focused()
        click(btns["Projects"])
        click(btns["Branches"])
        expect(btns["Projects"]).to_have_attribute("aria-expanded", "false")
        expect(btns["Branches"]).to_have_attribute("aria-expanded", "true")
        click(page.get_by_role("heading", name="Your desk", exact=True))
        expect(btns["Branches"]).to_have_attribute("aria-expanded", "false")
        click(btns["Workspace"])
        ws = show(page, page.get_by_role("navigation", name="Workspace"), "Workspace dropdown")
        assert ws.get_by_role("link", name="Translation memory").count() and ws.get_by_role("link", name="Settings").count()
        page.keyboard.press("Escape")
        click(btns["Review"])
        show(page, page.get_by_role("navigation", name="Review").get_by_role("link", name="Review queue"), "Review queue link")
        page.keyboard.press("Escape")
        for role, name in (("link", "Audit log"), ("button", "Sign out"), ("button", "New project"), ("link", "Import")):
            show(page, page.get_by_role(role, name=name, exact=True), name)
        expect(page.get_by_role("button", name="Target language")).to_be_disabled()
        page.goto(f"{app_url}/projects/{s}")
        show(page, page.get_by_role("tablist", name="Branches"), "project page")
        assert page.get_by_role("link", name="Import", exact=True).get_attribute("href").endswith(f"/projects/{s}/tm")
        click(page.get_by_role("button", name="Target language"))
        menu = show(page, page.get_by_role("menu", name="Target language"), "Target language menu")
        assert menu.get_by_role("menuitemradio").count() == 2
        page.keyboard.press("Escape")
        assert workflow_columns(page) == 3
        assert page.get_by_role("button", name="Previous workflow").count() == 0 or not page.get_by_role("button", name="Previous workflow").is_visible()
        layout(page)
    _, email, key, _ = invite(c, s)
    with browse(browser, app_url, "/review", who=api(app_url, email, key)) as page:
        show(page, page.get_by_role("heading", name="Review queue", exact=True), "review queue")
        for name in ("Review", "Target language", "Sign out"):
            show(page, page.get_by_role("button", name=name, exact=True), name)
        for role, name in (("button", "Projects"), ("button", "Branches"), ("button", "Workspace"), ("link", "Audit log"), ("button", "New project"), ("link", "Import")):
            assert page.get_by_role(role, name=name, exact=True).count() == 0, f"reviewers do not see {name}"


def test_wf_cross_cutting_tablet_shell(browser, app_url):
    c = api(app_url)
    s = project(c, "tab")["slug"]
    with browse(browser, app_url, "/", size=(768, 1024), keep_notice=True) as page:
        assert landing_checks(page, 768) == 2
        notice_checks(page, 768, 1024)
        layout(page)
    with browse(browser, app_url, f"/projects/{s}", who=c, size=(768, 1024)) as page:
        show(page, page.get_by_role("tablist", name="Branches"), "project page")
        assert workflow_columns(page) == 2
        assert page.get_by_role("button", name="Next workflow").count() == 0 or not page.get_by_role("button", name="Next workflow").is_visible()
        layout(page)
        page.goto(app_url + "/desk")
        show(page, page.get_by_role("heading", name="Your desk", exact=True), "dashboard")
        layout(page)


def in_view(locator, width) -> bool:
    b = locator.bounding_box()
    return bool(b) and b["x"] >= 0 and b["x"] + b["width"] <= width and b["width"] > 0


def test_wf_cross_cutting_mobile_shell(browser, app_url):
    c = api(app_url)
    p = project(c, "mob")
    s = p["slug"]
    branch(c, s, "mob/one")
    with browse(browser, app_url, "/", size=(375, 812), keep_notice=True) as page:
        assert landing_checks(page, 375) == 1
        notice_checks(page, 375, 812)
        layout(page)
    with browse(browser, app_url, f"/projects/{s}", who=c, size=(375, 812)) as page:
        show(page, page.get_by_role("tablist", name="Branches"), "project page")
        click(page.get_by_role("button", name="Open menu"))
        menu = show(page, page.get_by_role("dialog", name="Menu"), "Menu sheet")
        expect(menu.get_by_role("button", name="Close menu")).to_be_focused()
        acc = menu.get_by_role("button", name="Projects", exact=True)
        expect(acc).to_have_attribute("aria-expanded", "false")
        click(acc)
        expect(acc).to_have_attribute("aria-expanded", "true")
        show(page, menu.get_by_role("link", name=p["name"]), "project link in the menu")
        click(acc)
        expect(acc).to_have_attribute("aria-expanded", "false")
        for name in ("Branches", "Review", "Workspace", "New project", "Sign out"):
            show(page, menu.get_by_role("button", name=name, exact=True), name)
        click(menu.get_by_role("button", name="Close menu"))
        gone(page, page.get_by_role("dialog", name="Menu"), "Close menu")
        expect(page.get_by_role("button", name="Open menu")).to_be_focused()
        region = page.get_by_role("region", name="Workflows")
        dots = [region.get_by_role("button", name=f"Show workflow {n}") for n in range(1, 7)]
        expect(dots[0]).to_have_attribute("aria-current", "true")
        cards = [region.get_by_role("button", name=n, exact=True) for n in WORKFLOW_BUTTONS]
        click(region.get_by_role("button", name="Next workflow"))
        expect(dots[1]).to_have_attribute("aria-current", "true")
        poll(lambda: (in_view(cards[1], 375), in_view(cards[0], 375)), lambda v: v == (True, False), UI_WAIT_S, "Next shows the second workflow card")
        click(region.get_by_role("button", name="Previous workflow"))
        expect(dots[0]).to_have_attribute("aria-current", "true")
        click(dots[5])
        expect(dots[5]).to_have_attribute("aria-current", "true")
        poll(lambda: in_view(cards[5], 375), bool, UI_WAIT_S, "dot 6 shows the Publish card")
        targets = [page.get_by_role("button", name="Open menu"), region.get_by_role("button", name="Previous workflow"), region.get_by_role("button", name="Next workflow")] + dots
        targets += [page.get_by_role("tab", name=n, exact=True) for n in ("main", "mob/one")]
        for t in targets:
            b = box(t)
            assert round(b["width"]) >= TOUCH_PX and round(b["height"]) >= TOUCH_PX, (t, b)
        layout(page)


def test_motion_and_reduced_motion(browser, app_url):
    c = api(app_url)
    mark_text = f"Wordmark client {tag('mq')}"
    for _ in range(4):
        project(c, "mq", client=f"{mark_text} {tag('mq')}{tag('mq')}")
    s = project(c, "mot")["slug"]
    with browse(browser, app_url, "/desk", who=c) as page:
        primary = show(page, page.get_by_role("button", name="New project"), "primary button")
        rest, hover = state_styles(primary, "background-color")
        assert rest["background-color"] != hover["background-color"]
        durs = ms(style(primary, DURATION)[DURATION])
        assert 0 < max(durs) <= UI_MAX_MS
        outline = page.get_by_role("link", name="Open audit log")
        rest, hover = state_styles(outline, "background-color")
        assert rest["background-color"] != hover["background-color"]
        assert float(style(page.get_by_role("button", name="Target language"), "opacity")["opacity"]) < 1, "disabled controls are faded"
        for path in ("/desk", "/", f"/projects/{s}"):
            page.goto(app_url + path)
            show(page, page.get_by_role("heading").first, path)
            assert page.evaluate(LOOPS_JS) == 0, f"no infinite loops on {path}"
    with browse(browser, app_url, "/desk", who=c, size=(375, 812)) as page:
        strip = show(page, page.get_by_role("region", name="Client apps"), "wordmark strip")
        anims = [a for a in strip.evaluate(ANIMS_JS) if a["duration"] >= MARQUEE_PASS_MS / 2]
        if anims:
            a = anims[0]
            assert a["duration"] <= MARQUEE_PASS_MS * 2 and 0 < a["iterations"] <= MARQUEE_PASSES, a
            strip.hover()
            assert any(x["state"] == "paused" for x in strip.evaluate(ANIMS_JS) if x["duration"] >= MARQUEE_PASS_MS / 2)
        else:
            mark = strip.get_by_text(mark_text).first
            x0 = box(mark)["x"]
            advance(page, MARQUEE_PASS_MS / 10)
            assert box(mark)["x"] != x0, "the overflowing strip scrolls"
            advance(page, MARQUEE_PASS_MS * MARQUEE_PASSES)
            x1 = box(mark)["x"]
            advance(page, MARQUEE_PASS_MS / 10)
            assert box(mark)["x"] == x1, "it stops for good after two passes"
    with browse(browser, app_url, "/desk", who=c, size=(375, 812), reduced="reduce") as page:
        strip = show(page, page.get_by_role("region", name="Client apps"), "wordmark strip")
        assert not [a for a in strip.evaluate(ANIMS_JS) if a["state"] == "running" and a["duration"] > INSTANT_MS]
        mark = strip.get_by_text(mark_text).first
        x0 = box(mark)["x"]
        advance(page, MARQUEE_PASS_MS / 10)
        assert box(mark)["x"] == x0, "the wordmark strip never moves under reduced motion"
        btn = page.get_by_role("button", name="Open menu")
        assert max(ms(style(btn, DURATION)[DURATION])) <= INSTANT_MS
        page.goto(f"{app_url}/projects/{s}")
        region = show(page, page.get_by_role("region", name="Workflows"), "Workflows")
        page.evaluate(MOTION_JS)
        click(region.get_by_role("button", name="Next workflow"))
        assert region.get_by_role("button", name=f"Show workflow {2}").get_attribute("aria-current") == "true"
        advance(page, STEP_MS)
        assert not [m for m in motion_log(page) if m["duration"] > INSTANT_MS], motion_log(page)


def test_wf_legacy_import_happy(browser, app_url):
    c = api(app_url)
    s = project(c, "lgui")["slug"]
    t = tag("lgui")
    add_key(c, s, "ivt.k", f"Keep {t}")
    data = csv_bytes([(f"keep {t}", f"Behalten {t}", "de"), (f"KEEP {t}", f"behalten {t}", "de"), (f"Orphan {t}", f"Waise {t}", "de")])
    with browse(browser, app_url, f"/projects/{s}/tm", who=c) as page:
        form = show(page, page.get_by_role("form", name="Import translation memory"), "import form")
        page.get_by_label("Import file").set_input_files(files=[{"name": "legacy.csv", "mimeType": "text/csv", "buffer": data}])
        select(form.get_by_role("combobox", name="Format"), "CSV")
        click(form.get_by_role("button", name="Import"))
        msg = reads(page, updates(page), "Imported 2 new entries, merged 1 duplicates and reused 1 exact matches.", "import success copy")
        assert "1 rows need attention." in msg
        report = reads(page, page.get_by_role("region", name="Import report"), lambda x: "Line" in x and "Reason" in x and "4" in x, "report table")
        assert "Line" in report
        link = show(page, page.get_by_role("link", name="Download original"), "Download original")
        got = page.request.get(urljoin(page.url, link.get_attribute("href")))
        assert got.status == 200 and got.body() == data
        page.goto(f"{app_url}/projects/{s}")
        health = page.get_by_role("region", name="Import health")
        reads(page, health, lambda x: has_figure(x, "Entries added", 2) and has_figure(x, "Duplicates merged", 1) and has_figure(x, "Exact matches reused", 1) and has_figure(x, "Rows needing attention", 1), "Import health figures")
        show(page, health.get_by_role("link", name="Open import report"), "Open import report")
        show(page, page.get_by_role("region", name="Merge health").get_by_role("link", name="Open merge preview"), "Merge health card")
    assert segment(c, seg_id(c, s, "ivt.k", "de"))["value"] == f"Behalten {t}"


def test_wf_legacy_import_reimport(browser, app_url):
    c = api(app_url)
    s = project(c, "lgre")["slug"]
    t = tag("lgre")
    data = csv_bytes([(f"Twice {t}", f"Zweimal {t}", "de")])
    with browse(browser, app_url, f"/projects/{s}/tm", who=c) as page:
        form = show(page, page.get_by_role("form", name="Import translation memory"), "import form")
        for expected in ("Imported 1 new entries, merged 0 duplicates and reused 0 exact matches.", "Imported 0 new entries, merged 1 duplicates and reused 0 exact matches."):
            page.get_by_label("Import file").set_input_files(files=[{"name": "twice.csv", "mimeType": "text/csv", "buffer": data}])
            select(form.get_by_role("combobox", name="Format"), "CSV")
            click(form.get_by_role("button", name="Import"))
            reads(page, updates(page), expected, "import copy")
    assert tm_entries(c, s)["total"] == 1


def manifest() -> dict:
    return json.loads(Path("/app/run.json").read_text())


def test_if_run_manifest():
    m = manifest()
    assert m.get("_schema") == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(m.get(field), str) and m[field].strip(), field


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    for font in ("Figtree", "Inter"):
        assert re.search(rf"\b{font}\b", notices), font


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    lines = Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in ("Figtree", "Inter"):
        named = [l for l in lines if re.search(rf"\b{font}\b", l)]
        assert any(any(lic in l for lic in ALLOWED_LICENCES) for l in named), font


def test_if_no_extra_datastore():
    found = []
    for root in {Path("/app"), Path(DEPLOYED_APP)}:
        for f in root.rglob("*"):
            if any(part in ("node_modules", ".git") for part in f.parts) or not f.is_file():
                continue
            with contextlib.suppress(OSError):
                with f.open("rb") as fh:
                    if fh.read(16) == b"SQLite format 3\x00":
                        found.append(str(f))
    assert not found, found
    procs = []
    for comm in Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            procs.append(comm.read_text().strip())
    assert not {"redis-server", "valkey-server", "sqlite3", "mongod", "etcd", "memcached"} & set(procs)


def test_if_service_config_untouched(svix):
    pg = Postgres()
    assert pg.tables()
    assert pg.rows("SELECT r.rolsuper AS su FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = current_database()")[0]["su"] is False
    assert isinstance(S3().keys(""), list)
    assert isinstance(svix.applications(), list)


def test_if_lockfiles_committed():
    dirs = project_dirs(Path("/app"))
    assert any((d / "go.sum").is_file() and (d / "go.mod").is_file() for d in dirs)
    assert any((d / "package-lock.json").is_file() or (d / "npm-shrinkwrap.json").is_file() for d in dirs)
    m = manifest()
    install = m["install"] + " && " + m["build"]
    assert "npm ci" in install and not re.search(r"npm (install|i)\b", install)
