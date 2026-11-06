from __future__ import annotations

import contextlib
import hashlib
import html
import json
import os
import pwd
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    advance,
    axe,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    open_app,
    post_json,
    same_origin,
    select,
    settle,
    unique,
    until,
)


OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "deku-demo-pw-2026"
TOKEN_MIN_CHARS = 16
LOCKOUT_ATTEMPTS = 5
DEFAULT_LOCKOUT_S = 900
DEFAULT_LIFETIME_S = 43200
BODY_LIMIT = 32768
HOSTILE_EMAIL_CHARS = 20000
EMAIL_BUDGET_S = 2
DUPLICATE_WINDOW_S = 60
COVER_GONE_S = 3
TITLE_MAX = 80
SLUG_MAX = 64
SUMMARY_MAX = 200
LONG_MAX = 2000
YEAR_MIN = 1990
YEAR_MAX = 2100
POSITION_MAX = 9999
NAME_MAX = 120
PHONE_MIN = 7
EMAIL_MAX = 254
MESSAGE_MIN = 10
MESSAGE_MAX = 4000
REVEAL_MAX_MS = 1250
DRIFT_MIN_MS = 15000
RING_MIN_MS = 15000
RING_MAX_MS = 25000
PULSE_MIN_MS = 1000
PULSE_MAX_MS = 2000
FOCUS_RING_PX = 2
QUARTER_MIN = 0.15
QUARTER_MAX = 0.35
PHONE_RATIO_MIN = 0.2
PHONE_RATIO_MAX = 0.5
VIEWPORTS = {320: 812, 375: 812, 768: 1024, 1280: 800}
TEST_POSITION = POSITION_MAX


HTTP_TIMEOUT = 30
COPY_START_S = 120
WAIT_S = 45
UI_DEADLINE_S = 15
QUICK_MS = 1000
STEP_MS = 250
SAMPLE_MS = 200
REVEAL_STEP_MS = 50
SCRATCH_SEED_S = 120
POLL_S = 0.25
LOCK_WINDOW_PROBE_S = 12
LIFETIME_PROBE_S = 6

SEED_PUBLISHED = ["hollow-signal", "ember-ledger", "night-cartography", "vanta-atelier", "low-tide-radio"]
SEED_TITLES = {
    "hollow-signal": "Hollow Signal",
    "ember-ledger": "Ember Ledger",
    "night-cartography": "Night Cartography",
    "vanta-atelier": "Vanta Atelier",
    "low-tide-radio": "Low Tide Radio",
    "red-meridian": "Red Meridian",
}
SEED_JOURNAL = [
    ("unfinished-light", "2026-08-03", False),
    ("motion-beyond-animation", "2026-07-01", True),
    ("the-psychology-of-dark-interfaces", "2026-06-14", True),
    ("designing-experiences-not-websites", "2026-05-22", True),
]
SEED_RECOGNITIONS = [
    {"award": "Developer Award", "issuer": "Juried Web Annual", "d": "2026-09-26"},
    {"award": "Site of the Day", "issuer": "Juried Web Annual", "d": "2026-09-12"},
    {"award": "Honorable Mention", "issuer": "Juried Web Annual", "d": "2026-08-30"},
]
SEED_FIGURES = [
    {"value": "10+", "label": "Brands served", "caption": "Each one different. Each one demanding something sharper."},
    {"value": "25+", "label": "Projects shipped", "caption": "Each one pushed beyond the obvious."},
    {"value": "6+", "label": "Years of practice", "caption": "Learning fast. Moving faster."},
]
HOLLOW_SUMMARY = "A launch film for a sound hardware brand, told as a single descent through red light."
DRAFT_SLUG = "red-meridian"
MOTION_ENTRY = "motion-beyond-animation"
HIDDEN_ENTRY = "unfinished-light"
HIDDEN_ENTRY_TITLE = "Unfinished Light"
BAD_FILTER = "/work?discipline=design"
TABLES = {"accounts", "sessions", "sign_in_attempts", "case_studies", "journal_entries", "recognitions", "figures", "inquiries"}
EDITABLE = ["title", "discipline", "summary", "challenge", "approach", "outcome", "stack", "year", "featured", "position"]
DISCIPLINES = ["ui-ux", "3d-web", "frontend"]
DISPLAY = {"ui-ux": "UI/UX", "3d-web": "3D WEB", "frontend": "FRONTEND"}
FILTERS = {"All": "/work", "UI/UX": "/work?discipline=ui-ux", "3D WEB": "/work?discipline=3d-web", "FRONTEND": "/work?discipline=frontend"}
ANCHORS = ["hero", "about", "services", "work", "process", "journal", "awards", "contact"]
NAV_LINKS = [("HOME", "/"), ("ABOUT", "/#about"), ("SERVICES", "/#services"), ("WORK", "/work"), ("BLOG", "/journal"), ("CONTACT US", "/contact")]
PUBLIC_PAGES = ["/", "/work", "/work/hollow-signal", "/journal", "/journal/motion-beyond-animation", "/contact"]
STATEMENT = "IT WAS ALWAYS GOING TO BE THIS WAY"
INTRO = "I create digital experiences that aren't just seen, they're felt. From the first impression to the smallest interaction, I focus on making every experience clear, immersive, and memorable."
ROLES = ["VISUAL STORYTELLER", "UI/UX DESIGNER", "3D WEB DEVELOPER"]
ABOUT = "I don't build websites, I build experiences people enjoy exploring."
SKILLS_3D = ["Frontend Engineering", "Three.js / WebGL", "GSAP Animation", "Performance Optimization"]
PROCESS = {
    "Discovery": "Every great story begins with understanding. I explore your vision, audience, and goals to uncover the foundation for an experience that feels authentic and unforgettable.",
    "Creative Direction": "Ideas take shape through thoughtful research, wireframes, visual exploration, motion concepts, and design systems.",
    "Digital Craftsmanship": "With strategy in place, I transform concepts into immersive experiences, with every line of code crafted for performance, accessibility, and lasting impact.",
    "Launch & Evolution": "A successful launch is only the beginning. I monitor, refine, and evolve the product to keep it relevant, engaging, and aligned with business goals.",
}
CLOSING = "From the First Idea to the Final Frame Every Step Is Crafted to Create an Unforgettable Digital Experience."
JOURNAL_INTRO = "A collection of experiments, creative processes, front-end discoveries, and visual stories."
AWARDS_HEADING = "AWARDS & RECOGNITIONS"
AWARDS_INTRO = "Forged in obsession, shaped in darkness, and recognized beyond the screen."
THANKS = "Thanks, your message is in. I reply within two working days."
SENDING = "Sending your message…"
DESCRIPTION = "Cinematic web experiences by a solo creative developer."
VIEWPORT_META = "width=device-width, initial-scale=1"
HINTS = {
    "Title": "1 to 80 characters",
    "Slug": "Lowercase letters, digits and single hyphens, up to 64 characters",
    "Summary": "Up to 200 characters",
    "Stack": "Up to 200 characters",
    "Challenge": "Up to 2000 characters",
    "Approach": "Up to 2000 characters",
    "Outcome": "Up to 2000 characters",
    "Year": "A whole number from 1990 to 2100",
    "Position": "A whole number from 1 to 9999",
}
AXE_PAGES = {
    "home": "/",
    "work": "/work",
    "case-study": "/work/hollow-signal",
    "journal": "/journal",
    "journal-entry": "/journal/motion-beyond-animation",
    "contact": "/contact",
    "studio-login": "/studio/login",
}
LAYOUT_PAGES = {"home": "/", "work": "/work", "case-study": "/work/hollow-signal", "contact": "/contact", "studio": "/studio"}


COVER_JS = r"""() => {
  const vw = innerWidth, vh = innerHeight;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (!(el.textContent || '').toLowerCase().includes('ivo kastrel')) continue;
    const r = el.getBoundingClientRect();
    if (r.left > 1 || r.top > 1 || r.right < vw - 1 || r.bottom < vh - 1) continue;
    let node = el, opacity = 1, shown = true, inMain = false, hidden = false;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') shown = false;
      opacity *= parseFloat(s.opacity);
      if (node.tagName === 'MAIN' || node.getAttribute('role') === 'main') inMain = true;
      // The brief asks only that the cover be hidden from assistive technology: aria-hidden
      // and inert both do that, on the cover itself or on an ancestor holding it.
      if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) hidden = true;
      node = node.parentElement;
    }
    if (shown && hidden && !inMain && opacity > 0.05) return true;
  }
  return false;
}"""

LOOPS_JS = r"""(motion) => {
  const find = (word, all) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.toUpperCase().includes(word)) continue;
      let el = n.parentElement;
      while (el && !all.every(x => el.textContent.toUpperCase().includes(x))) el = el.parentElement;
      return el;
    }
    return null;
  };
  const online = find('ONLINE', ['ONLINE']);
  const zones = [
    ['hero', document.getElementById('hero')],
    ['process', document.getElementById('process')],
    ['motion', motion],
    ['pill', online && online.parentElement],
    ['rail', find('TENSION', ['TENSION', 'IMMERSION', 'IMPACT'])],
  ];
  // A layer drawn over a zone belongs to it: the brief puts grain "over the hero", not inside it.
  const covers = (root, t) => {
    if (!root || !t || t.nodeType !== 1) return false;
    const a = root.getBoundingClientRect(), b = t.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.left < a.right && a.left < b.right
      && b.top < a.bottom && a.top < b.bottom;
  };
  return document.getAnimations()
    .filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity)
    .map(a => {
      const t = a.effect.target;
      const z = zones.find(([, root]) => root && t && root.contains(t))
        || zones.find(([, root]) => covers(root, t));
      // The brief times the visible cycle ("once every one and a half seconds"), and an
      // alternating animation shows one cycle per two iterations.
      const iteration = Number(a.effect.getComputedTiming().duration);
      const alternates = String(a.effect.getTiming().direction || '').startsWith('alternate');
      return {zone: z ? z[0] : 'other', duration: alternates ? iteration * 2 : iteration};
    });
}"""

SETTLED_JS = r"""(h) => [h, ...h.getElementsByTagName('*')].every(e => {
  const s = getComputedStyle(e);
  const blur = /blur\(([\d.]+)px\)/.exec(s.filter);
  return parseFloat(s.opacity) > 0.99 && (!blur || parseFloat(blur[1]) < 0.5);
})"""

WORDS_JS = r"""(h) => {
  const leaves = Array.from(h.getElementsByTagName('*')).filter(e => !e.children.length && e.textContent.trim());
  return {t: Number(document.timeline.currentTime), words: leaves.map(e => {
    let opacity = 1, blur = 0, moved = false;
    for (let n = e; n && n !== h.parentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      opacity *= parseFloat(s.opacity);
      const b = /blur\(([\d.]+)px\)/.exec(s.filter);
      if (b) blur = Math.max(blur, parseFloat(b[1]));
      if (s.transform && s.transform !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(s.transform)) moved = true;
      if (s.translate && s.translate !== 'none' && s.translate !== '0px') moved = true;
    }
    // y lets a rise read through any property: the brief fixes the movement, not how it is driven.
    return {opacity, blur, moved, y: e.getBoundingClientRect().top};
  })};
}"""

TIED_JS = r"""(f, m) => {
  const said = id => ((document.getElementById(id) || {}).textContent || '').includes(m);
  const refs = `${f.getAttribute('aria-describedby') || ''} ${f.getAttribute('aria-errormessage') || ''}`.split(/\s+/).filter(Boolean);
  if (refs.some(said)) return true;
  if (f.labels && Array.from(f.labels).some(l => l.textContent.includes(m))) return true;
  if ((f.getAttribute('aria-label') || '').includes(m)) return true;
  // A message printed beside the field belongs to the control it sits nearest to in document order.
  // Several fields share one hint text, so take the holder nearest this field, then require that no
  // other control sits closer to that holder than this field does.
  const nodes = [...(f.closest('form') || document.body).querySelectorAll('*')];
  const at = e => nodes.indexOf(e);
  const holders = nodes.filter(e => e.textContent.includes(m)
    && ![...e.children].some(c => c.textContent.includes(m)));
  if (!holders.length) return false;
  const holder = holders.reduce((a, b) => Math.abs(at(b) - at(f)) < Math.abs(at(a) - at(f)) ? b : a);
  const gap = e => Math.abs(at(e) - at(holder));
  return nodes.filter(e => e.matches('input, textarea, select')).every(c => c === f || gap(c) >= gap(f));
}"""

FOCUS_JS = r"""(px) => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const drawn = node => {
    for (const pseudo of [null, '::before', '::after']) {
      const s = getComputedStyle(node, pseudo);
      if ((parseFloat(s.outlineWidth) || 0) >= px && !['none', 'hidden'].includes(s.outlineStyle)) return true;
      if (s.boxShadow && s.boxShadow !== 'none') return true;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if ((parseFloat(s['border' + side + 'Width']) || 0) >= px
            && !['none', 'hidden'].includes(s['border' + side + 'Style'])) return true;
      }
    }
    return false;
  };
  let ringed = false;
  for (let node = e, up = 0; node && up < 3 && !ringed; node = node.parentElement, up++) ringed = drawn(node);
  return {name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60), ringed};
}"""

RECTS_JS = r"""([id, labels]) => {
  const root = document.getElementById(id);
  return labels.map(label => {
    const want = label.toUpperCase();
    const hits = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = w.currentNode; el; el = w.nextNode()) {
      if ((el.textContent || '').trim().toUpperCase().includes(want)) hits.push(el);
    }
    const inner = hits.find(el => !hits.some(o => o !== el && el.contains(o)));
    if (!inner) return null;
    const r = inner.getBoundingClientRect();
    return {top: r.top, bottom: r.bottom, left: r.left, right: r.right};
  });
}"""

ORDER_JS = r"""(ids) => ids.map(id => document.getElementById(id)).every((el, i, arr) =>
  el && (i === 0 || (arr[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)))"""

TEXT_JS = r"""(id) => {
  const el = document.getElementById(id);
  if (!el) return '';
  let scope = el.closest('section, article, [role=region]');
  for (let p = el.parentElement, i = 0; !scope && p && p.tagName !== 'BODY' && i < 3; p = p.parentElement, i++) {
    if ((p.textContent || '').length > ((scope || el).textContent || '').length) scope = p;
  }
  return ((scope || el).textContent) || '';
}"""

SHOWN_JS = r"""(e, v) => (e.textContent || '').includes(v)
  || [...e.querySelectorAll('input, textarea')].some(f => (f.value || '').includes(v))"""

HERO_BOTTOM_JS = "() => document.getElementById('hero').getBoundingClientRect().bottom + window.scrollY"


@pytest.fixture(scope="module")
def pg() -> Postgres:
    return Postgres()


def q(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def count(pg: Postgres, sql: str) -> int:
    return int(pg.rows(sql)[0]["n"])


def db_now(pg: Postgres) -> str:
    return pg.rows("SELECT now()::text AS t")[0]["t"]


def since(t0: str) -> str:
    return f"{q(t0)}::timestamptz"


def wait_db(pg: Postgres, sql: str, seconds: float = WAIT_S) -> None:
    end = time.monotonic() + seconds
    while not pg.rows(sql)[0]["ok"]:
        assert time.monotonic() < end, f"server clock never satisfied: {sql}"


def call(base: str, method: str, path: str, token: str | None = None, body: Any = None,
         *, content: bytes | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    sent = dict(headers or {})
    if token is not None:
        sent["Authorization"] = f"Bearer {token}"
    extra: dict[str, Any] = {}
    if content is not None:
        extra["content"] = content
    elif body is not None:
        extra["json"] = body
    return httpx.request(method, base + path, headers=sent, timeout=HTTP_TIMEOUT, follow_redirects=False, **extra)


def get(base: str, path: str) -> httpx.Response:
    return call(base, "GET", path)


def login(base: str, email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD) -> httpx.Response:
    return post_json(base, "/api/auth/login", {"email": email, "password": password})


def owner_token(base: str) -> str:
    r = login(base)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def fresh(prefix: str) -> tuple[str, str]:
    parts = unique(prefix)
    email = next((p for p in parts if "@" in p), None)
    name = next((p for p in parts if "@" not in p), parts[0])
    if email is None:
        email = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + "@example.com"
    return name, email


def new_slug(suffix: str = "") -> str:
    return f"t-{uuid.uuid4().hex[:12]}{suffix}"


def draft_fields(**over: Any) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "slug": new_slug(),
        "title": f"Test Study {uuid.uuid4().hex[:8]}",
        "discipline": "ui-ux",
        "summary": "A probe summary written by the verifier.",
        "challenge": "Probe challenge.",
        "approach": "Probe approach.",
        "outcome": "Probe outcome.",
        "stack": "Python",
        "year": 2026,
        "featured": False,
        "position": TEST_POSITION,
    }
    fields.update(over)
    return fields


def inquiry(**over: Any) -> dict[str, Any]:
    name, email = fresh("visitor")
    body = {
        "name": name,
        "phone": "+64 21 555 0100",
        "email": email,
        "message": f"Probe message {uuid.uuid4().hex} about a launch film.",
    }
    body.update(over)
    return body


def create_inquiry(base: str, **over: Any) -> dict[str, Any]:
    body = inquiry(**over)
    r = post_json(base, "/api/inquiries", body)
    assert r.status_code == 201, r.text
    return {**body, "id": r.json()["id"]}


def public_cases(base: str, query: str = "") -> list[dict[str, Any]]:
    r = get(base, "/api/cases" + query)
    assert r.status_code == 200, r.text
    return r.json()


def detail(base: str, slug: str) -> dict[str, Any]:
    r = get(base, f"/api/cases/{slug}")
    assert r.status_code == 200, r.text
    return r.json()


def two(n: int) -> str:
    return f"{n:02d}"


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text.replace("\u2019", "'").replace("\u2018", "'").replace("\xa0", " ")).lower()


def page_text(base: str, path: str) -> str:
    r = get(base, path)
    return squash(html.unescape(re.sub(r"<[^>]+>", "", r.text)))


def fmt_date(value: str) -> str:
    d = date.fromisoformat(value)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def href(path: str) -> re.Pattern[str]:
    return re.compile(rf"^(https?://[^/]+)?{re.escape(path)}$")


def count_copy(n: int) -> str:
    return "1 case study shown." if n == 1 else f"{n} case studies shown."


def together(n: int, action: Callable[[int], Any]) -> list[Any]:
    gate = threading.Barrier(n)

    def run(i: int) -> Any:
        gate.wait()
        return action(i)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(run, range(n)))


def unlock_sql(email: str, window: int) -> str:
    return (
        f"SELECT count(*) < {LOCKOUT_ATTEMPTS} AS ok FROM sign_in_attempts WHERE email = {q(email)} AND NOT succeeded "
        f"AND attempted_at > now() - make_interval(secs => {int(window)}) "
        f"AND attempted_at > coalesce((SELECT max(attempted_at) FROM sign_in_attempts WHERE email = {q(email)} AND succeeded), '-infinity')"
    )


def studio_calls(case_id: int, inquiry_id: int) -> tuple[list[tuple[str, str, Any]], str]:
    create = draft_fields(role="owner")
    calls = [
        ("GET", "/api/studio/cases", None),
        ("POST", "/api/studio/cases", create),
        ("PATCH", f"/api/studio/cases/{case_id}", {"title": "Hijacked title"}),
        ("POST", f"/api/studio/cases/{case_id}/publish", {"published": True}),
        ("DELETE", f"/api/studio/cases/{case_id}", None),
        ("GET", "/api/studio/inquiries", None),
        ("POST", f"/api/studio/inquiries/{inquiry_id}/resolve", None),
    ]
    return calls, create["slug"]


def assert_untouched(pg: Postgres, case: dict[str, Any], inquiry_id: int, created_slug: str) -> None:
    rows = pg.rows(f"SELECT title, published, published_at FROM case_studies WHERE id = {int(case['id'])}")
    assert rows == [{"title": case["title"], "published": False, "published_at": None}]
    assert pg.rows(f"SELECT status, resolved_at FROM inquiries WHERE id = {int(inquiry_id)}") == [{"status": "new", "resolved_at": None}]
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(created_slug)}") == 0


class Studio:
    def __init__(self, base: str) -> None:
        self.base = base
        self.token = owner_token(base)
        self.slugs: list[str] = []

    def call(self, method: str, path: str, body: Any = None) -> httpx.Response:
        return call(self.base, method, path, self.token, body)

    def make(self, **over: Any) -> dict[str, Any]:
        fields = draft_fields(**over)
        self.slugs.append(fields["slug"])
        r = self.call("POST", "/api/studio/cases", fields)
        assert r.status_code == 201, r.text
        return r.json()

    def publish(self, case_id: int, published: bool = True) -> httpx.Response:
        return self.call("POST", f"/api/studio/cases/{case_id}/publish", {"published": published})

    def rows(self) -> list[dict[str, Any]]:
        r = self.call("GET", "/api/studio/cases")
        assert r.status_code == 200, r.text
        return r.json()

    def cleanup(self) -> None:
        token = owner_token(self.base)
        for row in call(self.base, "GET", "/api/studio/cases", token).json():
            if row["slug"] in self.slugs:
                call(self.base, "DELETE", f"/api/studio/cases/{row['id']}", token)


@pytest.fixture
def studio(app_url: str):
    s = Studio(app_url)
    yield s
    s.cleanup()


@contextlib.contextmanager
def app_copy(*, healthy: bool = True, **env: str):
    root = Path(DEPLOYED_APP)
    serve = json.loads((root / "run.json").read_text())["serve"]
    owner, group = root.stat().st_uid, root.stat().st_gid
    home = pwd.getpwuid(owner).pw_dir
    launch = ["/bin/sh", "-c", serve] if owner == os.getuid() else [
        "setpriv", f"--reuid={owner}", f"--regid={group}", "--clear-groups", "/bin/sh", "-c", serve]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(
        launch, cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        env={**os.environ, "HOME": home, "PATH": f"{os.environ['PATH']}:{home}/.local/bin",
             "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **env},
    )

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + COPY_START_S
        while True:
            try:
                proc.wait(timeout=POLL_S)
                pytest.fail(f"serve copy exited with {proc.returncode}:\n{tail()}")
            except subprocess.TimeoutExpired:
                pass
            try:
                r = httpx.get(base + "/api/health", timeout=2)
                if r.status_code == 200 or not healthy:
                    break
            except httpx.TransportError:
                pass
            if time.monotonic() > deadline:
                pytest.fail(f"serve copy never answered /api/health:\n{tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


def psql(url: str, sql: str, check: bool = True) -> str | None:
    done = subprocess.run(["psql", url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    if done.returncode:
        assert not check, done.stderr
        return None
    return done.stdout.strip()


class Scratch:

    def __init__(self, url: str) -> None:
        self.url = url

    def rows(self, sql: str) -> list[dict[str, Any]]:
        return json.loads(psql(self.url, f"SELECT coalesce(json_agg(t), '[]'::json) FROM ({sql}) t"))

    def run(self, sql: str) -> None:
        psql(self.url, sql)


@contextlib.contextmanager
def scratch_app():
    main_url = os.environ["DATABASE_URL"]
    name = f"verifier_{uuid.uuid4().hex[:12]}"
    url = urlunsplit(urlsplit(main_url)._replace(path="/" + name))
    psql(main_url, f'CREATE DATABASE "{name}"')
    try:
        with app_copy(DATABASE_URL=url) as base:
            end = time.monotonic() + SCRATCH_SEED_S
            while psql(url, "SELECT count(*) FROM figures", check=False) != str(len(SEED_FIGURES)):
                assert time.monotonic() < end, "scratch database never seeded"
            yield base, Scratch(url)
    finally:
        psql(main_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def add_entry(db: Scratch, entry: dict[str, str]) -> None:
    cols = "slug, title, excerpt, body, published_on, published, created_at"
    vals = (f"{q(entry['slug'])}, {q(entry['title'])}, 'Probe excerpt.', 'Probe body paragraph.', "
            f"{q(entry['day'])}::date, true, now()")
    if psql(db.url, f"INSERT INTO journal_entries ({cols}) VALUES ({vals})", check=False) is None:
        db.run(f"INSERT INTO journal_entries (id, {cols}) SELECT coalesce(max(id), 0) + 1, {vals} FROM journal_entries")


def see(page: Page, check_fn: Callable[[], None], seconds: float = UI_DEADLINE_S) -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            check_fn()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, STEP_MS)


def cover_gone(page: Page, seconds: float = UI_DEADLINE_S) -> None:
    until(page, f"() => !({COVER_JS})()", seconds=seconds)


def at_url(page: Page, url: str) -> None:
    see(page, lambda: expect(page).to_have_url(url, timeout=QUICK_MS))


def sign_in_ui(page: Page, base: str) -> None:
    page.goto(base + "/studio/login")
    cover_gone(page)
    main = page.get_by_role("main")
    fill(main.get_by_role("textbox", name="Email"), OWNER_EMAIL)
    fill(field_of(main, "Password"), OWNER_PASSWORD)
    click(main.get_by_role("button", name="Sign in"))
    at_url(page, base + "/studio")
    see(page, lambda: expect(page.get_by_role("region", name="Case studies", exact=True)).to_be_visible(timeout=QUICK_MS))


def choose(dropdown: Locator, api_value: str, label: str) -> None:
    options = dropdown.evaluate("s => Array.from(s.options).map(o => [o.value, o.textContent.trim()])")
    for value, text in options:
        if value == api_value or text.upper() == label.upper():
            select(dropdown, value)
            return
    pytest.fail(f"no option for {api_value} in {options}")


def field_of(form: Locator, label: str) -> Locator:
    return form.get_by_label(re.compile(rf"^{re.escape(label)}\b"))


def fill_editor(form: Locator, fields: dict[str, Any]) -> None:
    for label, key in (("Title", "title"), ("Slug", "slug"), ("Summary", "summary"), ("Challenge", "challenge"),
                       ("Approach", "approach"), ("Outcome", "outcome"), ("Stack", "stack"), ("Year", "year"),
                       ("Position", "position")):
        if key in fields:
            fill(field_of(form, label), str(fields[key]))
    if "discipline" in fields:
        choose(field_of(form, "Discipline"), fields["discipline"], DISPLAY[fields["discipline"]])
    if fields.get("featured"):
        check(field_of(form, "Featured"))


def studio_row(page: Page, title: str) -> Locator:
    return page.get_by_role("region", name="Case studies", exact=True).get_by_role("row").filter(
        has=page.get_by_role("button", name=f"Edit {title}", exact=True))


def fill_inquiry(scope: Locator, body: dict[str, Any]) -> None:
    fill(scope.get_by_role("textbox", name="Name"), body["name"])
    fill(scope.get_by_role("textbox", name="Phone"), body["phone"])
    fill(scope.get_by_role("textbox", name="Email"), body["email"])
    fill(scope.get_by_role("textbox", name="Message"), body["message"])


def widest(loc: Locator) -> Locator:
    n = loc.count()
    assert n, "element not found"
    widths = [loc.nth(i).evaluate("e => e.getBoundingClientRect().width") for i in range(n)]
    return loc.nth(widths.index(max(widths)))


def statement(page: Page) -> Locator:
    return widest(page.get_by_text(STATEMENT))


def statement_lefts(page: Page, stmt: Locator, positions: list[int]) -> list[float]:
    lefts = []
    for y in positions:
        page.evaluate("y => window.scrollTo({top: y, left: 0, behavior: 'instant'})", y)
        advance(page, SAMPLE_MS)
        lefts.append(stmt.evaluate("e => e.getBoundingClientRect().left"))
    return lefts


def loops(page: Page) -> list[dict[str, Any]]:
    motion = page.get_by_role("button", name="Motion").element_handle()
    return page.evaluate(LOOPS_JS, motion)


def unsettled_headings(page: Page) -> list[str]:
    return [h.inner_text() for h in page.get_by_role("main").get_by_role("heading").all() if not h.evaluate(SETTLED_JS)]


def token_in_tab(page: Page, base: str) -> str:
    stored = page.evaluate("() => Object.values(sessionStorage)")
    candidates = []
    for value in stored:
        candidates.append(value)
        candidates.extend(re.findall(r"[A-Za-z0-9._~+/=-]{16,}", value))
    for candidate in candidates:
        if call(base, "GET", "/api/studio/cases", candidate).status_code == 200:
            return candidate
    pytest.fail("the studio tab holds no working token")


def public_journal(pg: Postgres) -> list[dict[str, Any]]:
    today = pg.rows("SELECT (now() AT TIME ZONE 'Pacific/Auckland')::date::text AS d")[0]["d"]
    return pg.rows(
        "SELECT slug, title, published_on::text AS d FROM journal_entries "
        f"WHERE published AND published_on <= {q(today)}::date ORDER BY published_on DESC, slug")


class Head(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.lang: str | None = None
        self.meta: dict[str, str | None] = {}
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "title":
            self._in_title = True
        elif tag == "meta" and a.get("name"):
            self.meta[a["name"].lower()] = a.get("content")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def test_owner_sign_in_opens_studio(app_url: str, pg: Postgres) -> None:
    t0 = db_now(pg)
    r = login(app_url)
    assert r.status_code == 200
    token = r.json()["token"]
    assert isinstance(token, str) and len(token) >= TOKEN_MIN_CHARS
    assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)} AND revoked_at IS NULL") == 1
    fields = draft_fields()
    try:
        assert call(app_url, "GET", "/api/studio/cases", token).status_code == 200
        created = call(app_url, "POST", "/api/studio/cases", token, fields)
        assert created.status_code == 201
        case_id = created.json()["id"]
        assert call(app_url, "PATCH", f"/api/studio/cases/{case_id}", token, {"title": "Renamed probe"}).status_code == 200
        assert call(app_url, "POST", f"/api/studio/cases/{case_id}/publish", token, {"published": True}).status_code == 200
        assert call(app_url, "POST", f"/api/studio/cases/{case_id}/publish", token, {"published": False}).status_code == 200
        inq = create_inquiry(app_url)
        assert call(app_url, "GET", "/api/studio/inquiries", token).status_code == 200
        assert call(app_url, "POST", f"/api/studio/inquiries/{inq['id']}/resolve", token).status_code == 200
        assert pg.rows(f"SELECT status FROM inquiries WHERE id = {int(inq['id'])}") == [{"status": "resolved"}]
        assert call(app_url, "DELETE", f"/api/studio/cases/{case_id}", token).status_code == 204
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(fields['slug'])}") == 0
    finally:
        for row in call(app_url, "GET", "/api/studio/cases", owner_token(app_url)).json():
            if row["slug"] == fields["slug"]:
                call(app_url, "DELETE", f"/api/studio/cases/{row['id']}", owner_token(app_url))


def test_login_refusal_identical(app_url: str, pg: Postgres) -> None:
    t0 = db_now(pg)
    _, stranger = fresh("stranger")
    wrong = login(app_url, OWNER_EMAIL, "not-the-password")
    unknown = login(app_url, stranger, OWNER_PASSWORD)
    try:
        assert wrong.status_code == 401
        assert unknown.status_code == wrong.status_code
        assert unknown.content == wrong.content
        assert wrong.json() == {"error": "Email or password is incorrect."}
        assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)}") == 0
    finally:
        assert login(app_url).status_code == 200


def test_owner_password_hashed(pg: Postgres) -> None:
    rows = pg.rows(f"SELECT password_hash FROM accounts WHERE email = {q(OWNER_EMAIL)}")
    assert len(rows) == 1
    stored = str(rows[0]["password_hash"])
    assert OWNER_PASSWORD not in stored
    plain = OWNER_PASSWORD.encode()
    digests = {hashlib.md5(plain).hexdigest(), hashlib.sha1(plain).hexdigest(),
               hashlib.sha256(plain).hexdigest(), hashlib.sha512(plain).hexdigest()}
    assert not any(d in stored.lower() for d in digests)


def test_lockout_any_email(app_url: str, pg: Postgres) -> None:
    _, email = fresh("lockout")
    t0 = db_now(pg)
    for i in range(LOCKOUT_ATTEMPTS):
        assert login(app_url, email, f"wrong-{i}").status_code == 401
    locked = login(app_url, email, "wrong-again")
    assert locked.status_code == 429
    assert locked.json() == {"error": "Too many sign-in attempts. Try again later."}
    assert 1 <= int(locked.headers["Retry-After"]) <= DEFAULT_LOCKOUT_S
    shouted = login(app_url, f"  {email.upper()} ", "wrong-again")
    assert shouted.status_code == 429 and "token" not in shouted.json()
    rows = pg.rows(f"SELECT succeeded FROM sign_in_attempts WHERE email = {q(email.lower())} AND attempted_at >= {since(t0)}")
    assert len(rows) == LOCKOUT_ATTEMPTS + 2 and not any(r["succeeded"] for r in rows)
    assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)}") == 0


def release_owner(pg: Postgres, base: str, window: int) -> None:
    if login(base).status_code == 200:
        return
    wait_db(pg, unlock_sql(OWNER_EMAIL, window + 1))
    assert login(base).status_code == 200


def test_owner_lockout_and_release(pg: Postgres) -> None:
    window = LOCK_WINDOW_PROBE_S
    with app_copy(SIGN_IN_LOCKOUT_WINDOW_SECONDS=str(window)) as base:
        t0 = db_now(pg)
        try:
            for i in range(LOCKOUT_ATTEMPTS):
                assert login(base, OWNER_EMAIL, f"wrong-guess-{i}").status_code == 401
            locked = login(base)
            assert locked.status_code == 429
            assert "token" not in locked.json()
            assert 1 <= int(locked.headers["Retry-After"]) <= window
            assert login(base, f"  {OWNER_EMAIL.upper()} ").status_code == 429
            _, stranger = fresh("lockout")
            for i in range(LOCKOUT_ATTEMPTS):
                assert login(base, stranger, f"wrong-{i}").status_code == 401
            stranger_locked = login(base, stranger, OWNER_PASSWORD)
            assert stranger_locked.status_code == 429
            assert stranger_locked.content == locked.content
            assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)}") == 0
            owner_rows = pg.rows(f"SELECT succeeded FROM sign_in_attempts WHERE email = {q(OWNER_EMAIL)} AND attempted_at >= {since(t0)}")
            assert len(owner_rows) == LOCKOUT_ATTEMPTS + 2 and not any(r["succeeded"] for r in owner_rows)
            wait_db(pg, unlock_sql(OWNER_EMAIL, window + 1))
            freed = login(base)
            assert freed.status_code == 200
            assert len(freed.json()["token"]) >= TOKEN_MIN_CHARS
        finally:
            release_owner(pg, base, window)


def test_sign_out_ends_token(app_url: str, pg: Postgres, studio: Studio) -> None:
    case = studio.make()
    inq = create_inquiry(app_url)
    t0 = db_now(pg)
    token = owner_token(app_url)
    assert call(app_url, "GET", "/api/studio/cases", token).status_code == 200
    out = call(app_url, "POST", "/api/auth/logout", token)
    assert out.status_code == 204 and out.content == b""
    calls, created_slug = studio_calls(case["id"], inq["id"])
    for method, path, body in calls:
        r = call(app_url, method, path, token, body)
        assert r.status_code == 401, (method, path, r.text)
        assert r.json() == {"error": "Sign in to continue."}
    assert call(app_url, "POST", "/api/auth/logout", token).status_code == 401
    rows = pg.rows(f"SELECT revoked_at FROM sessions WHERE created_at >= {since(t0)}")
    assert len(rows) == 1 and rows[0]["revoked_at"] is not None
    assert_untouched(pg, case, inq["id"], created_slug)


def test_wf_owner_signs_in_happy(browser, app_url: str, pg: Postgres) -> None:
    with open_app(browser, app_url + "/studio") as page:
        at_url(page, app_url + "/studio/login")
        t0 = db_now(pg)
        sign_in_ui(page, app_url)
        expect(page.get_by_role("region", name="Inquiries", exact=True)).to_be_visible()
        page.reload()
        at_url(page, app_url + "/studio")
        see(page, lambda: expect(page.get_by_role("region", name="Case studies", exact=True)).to_be_visible(timeout=QUICK_MS))
        see(page, lambda: expect(page.get_by_role("region", name="Inquiries", exact=True)).to_be_visible(timeout=QUICK_MS))
        click(page.get_by_role("button", name="Sign out"))
        at_url(page, app_url + "/studio/login")
    rows = pg.rows(f"SELECT revoked_at FROM sessions WHERE created_at >= {since(t0)}")
    assert len(rows) == 1 and rows[0]["revoked_at"] is not None


def test_wf_owner_signs_in_refused(browser, app_url: str, pg: Postgres) -> None:
    _, stranger = fresh("locked")
    for i in range(LOCKOUT_ATTEMPTS):
        assert login(app_url, stranger, f"wrong-{i}").status_code == 401
    t0 = db_now(pg)
    with open_app(browser, app_url + "/studio/login") as page:
        cover_gone(page)
        main = page.get_by_role("main")
        email = main.get_by_role("textbox", name="Email")
        password = field_of(main, "Password")
        alert = page.get_by_role("alert", name="Sign-in errors")
        fill(email, OWNER_EMAIL)
        fill(password, "not-the-password")
        click(main.get_by_role("button", name="Sign in"))
        see(page, lambda: expect(alert).to_contain_text("Email or password is incorrect.", timeout=QUICK_MS))
        expect(page).to_have_url(app_url + "/studio/login")
        expect(email).to_have_value(OWNER_EMAIL)
        fill(email, stranger)
        fill(password, OWNER_PASSWORD)
        click(main.get_by_role("button", name="Sign in"))
        see(page, lambda: expect(alert).to_contain_text("Too many sign-in attempts. Try again later.", timeout=QUICK_MS))
        expect(page).to_have_url(app_url + "/studio/login")
        expect(email).to_have_value(stranger)
        assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)}") == 0
        fill(email, OWNER_EMAIL)
        fill(password, OWNER_PASSWORD)
        click(main.get_by_role("button", name="Sign in"))
        at_url(page, app_url + "/studio")
    assert count(pg, f"SELECT count(*) AS n FROM sessions WHERE created_at >= {since(t0)}") == 1


def test_studio_endpoints_refuse_visitors(app_url: str, pg: Postgres, studio: Studio) -> None:
    case = studio.make()
    inq = create_inquiry(app_url)
    forged = "forged-" + uuid.uuid4().hex
    calls, created_slug = studio_calls(case["id"], inq["id"])
    for method, path, body in calls:
        for token in (None, forged):
            r = call(app_url, method, path, token, body)
            assert r.status_code == 401, (method, path, token, r.text)
            assert r.json() == {"error": "Sign in to continue."}
    claim = call(app_url, "POST", "/api/studio/cases", None, draft_fields(role="owner", slug=created_slug),
                 headers={"X-Role": "owner"})
    assert claim.status_code == 401
    _, stranger = fresh("claimant")
    sneaky = post_json(app_url, "/api/auth/login", {"email": stranger, "password": "x-guess-1", "role": "owner"})
    assert sneaky.status_code != 200 and "token" not in sneaky.json()
    assert_untouched(pg, case, inq["id"], created_slug)


def test_session_lifetime(app_url: str, pg: Postgres, studio: Studio) -> None:
    t_main = db_now(pg)
    owner_token(app_url)
    lifetime = pg.rows(f"SELECT extract(epoch FROM expires_at - created_at)::float AS s FROM sessions WHERE created_at >= {since(t_main)}")
    assert len(lifetime) == 1 and abs(lifetime[0]["s"] - DEFAULT_LIFETIME_S) < 1
    case = studio.make()
    inq = create_inquiry(app_url)
    with app_copy(SESSION_LIFETIME_SECONDS=str(LIFETIME_PROBE_S)) as copy:
        t0 = db_now(pg)
        token = owner_token(copy)
        rows = pg.rows(f"SELECT id, expires_at::text AS e, extract(epoch FROM expires_at - created_at)::float AS s FROM sessions WHERE created_at >= {since(t0)}")
        assert len(rows) == 1 and abs(rows[0]["s"] - LIFETIME_PROBE_S) < 1
        session_id, expires = rows[0]["id"], rows[0]["e"]
        assert call(copy, "GET", "/api/studio/cases", token).status_code == 200
        assert call(app_url, "GET", "/api/studio/inquiries", token).status_code == 200
        assert pg.rows(f"SELECT expires_at::text AS e FROM sessions WHERE id = {int(session_id)}")[0]["e"] == expires
        wait_db(pg, f"SELECT now() >= expires_at AS ok FROM sessions WHERE id = {int(session_id)}")
        calls, created_slug = studio_calls(case["id"], inq["id"])
        for base in (copy, app_url):
            for method, path, body in calls:
                r = call(base, method, path, token, body)
                assert r.status_code == 401, (base, method, path, r.text)
            assert call(base, "POST", "/api/auth/logout", token).status_code == 401
        assert_untouched(pg, case, inq["id"], created_slug)


def test_wf_studio_access_gate(browser, app_url: str, pg: Postgres) -> None:
    inq = create_inquiry(app_url)
    token = owner_token(app_url)
    for headers in ({}, {"Authorization": f"Bearer {token}"}):
        raw = httpx.get(app_url + "/studio", headers=headers, timeout=HTTP_TIMEOUT, follow_redirects=True)
        assert raw.status_code == 200
        for secret in ("Hollow Signal", "hollow-signal", "Red Meridian", "red-meridian", inq["message"], inq["email"]):
            assert secret not in raw.text, secret
    with open_app(browser, app_url + "/studio") as page:
        at_url(page, app_url + "/studio/login")
        sign_in_ui(page, app_url)
        held_token = token_in_tab(page, app_url)
        assert call(app_url, "POST", "/api/auth/logout", held_token).status_code == 204
        page.reload()
        at_url(page, app_url + "/studio/login")
        page.goto(app_url + "/studio")
        at_url(page, app_url + "/studio/login")


def test_wf_studio_access_expired(browser, pg: Postgres) -> None:
    with app_copy(SESSION_LIFETIME_SECONDS=str(LIFETIME_PROBE_S)) as copy:
        with open_app(browser, copy + "/studio/login") as page:
            t0 = db_now(pg)
            sign_in_ui(page, copy)
            rows = pg.rows(f"SELECT id FROM sessions WHERE created_at >= {since(t0)}")
            assert len(rows) == 1
            wait_db(pg, f"SELECT now() >= expires_at AS ok FROM sessions WHERE id = {int(rows[0]['id'])}")
            page.reload()
            at_url(page, copy + "/studio/login")


def test_draft_absent_from_public_reads(app_url: str, pg: Postgres) -> None:
    assert pg.rows("SELECT published FROM case_studies WHERE slug = 'red-meridian'") == [{"published": False}]
    for query in ["", "?discipline=ui-ux", "?discipline=3d-web", "?discipline=frontend"]:
        assert "red-meridian" not in [c["slug"] for c in public_cases(app_url, query)]
    for path in ["/work", "/work?discipline=frontend", "/"]:
        text = get(app_url, path).text.lower()
        assert DRAFT_SLUG not in text and SEED_TITLES[DRAFT_SLUG].lower() not in text, path


def test_not_found_identical(app_url: str) -> None:
    probe = f"no-such-{uuid.uuid4().hex[:8]}"
    for prefix, hidden in (("/api/cases/", "red-meridian"), ("/work/", "red-meridian"),
                           ("/api/journal/", "unfinished-light"), ("/journal/", "unfinished-light")):
        a, b = get(app_url, prefix + hidden), get(app_url, prefix + probe)
        assert a.status_code == 404 and b.status_code == 404, prefix
        assert a.content == b.content, prefix
        assert hidden not in a.text and probe not in b.text
        if prefix.startswith("/api"):
            assert a.json() == {"error": "Not found."}


def test_no_widening_query_parameters(app_url: str) -> None:
    widen = "published=false&include=drafts&all=1&status=draft&preview=1"
    frontend = "?discipline=frontend"
    assert get(app_url, "/api/cases?" + widen).json() == get(app_url, "/api/cases").json()
    assert get(app_url, f"/api/cases{frontend}&{widen}").json() == get(app_url, "/api/cases" + frontend).json()
    assert get(app_url, "/api/journal?" + widen).json() == get(app_url, "/api/journal").json()
    assert get(app_url, f"/api/cases/{DRAFT_SLUG}?{widen}").status_code == 404
    assert get(app_url, f"/api/journal/{HIDDEN_ENTRY}?{widen}").status_code == 404
    for path in ["/", "/work", "/journal"]:
        text = get(app_url, f"{path}?{widen}").text.lower()
        assert SEED_TITLES[DRAFT_SLUG].lower() not in text and HIDDEN_ENTRY_TITLE.lower() not in text, path


def test_canonical_addresses_only(app_url: str, pg: Postgres) -> None:
    case_id = pg.rows("SELECT id FROM case_studies WHERE slug = 'hollow-signal'")[0]["id"]
    entry_id = pg.rows("SELECT id FROM journal_entries WHERE slug = 'motion-beyond-animation'")[0]["id"]
    for prefix, slug, rid in (("/work/", "hollow-signal", case_id), ("/api/cases/", "hollow-signal", case_id),
                              ("/journal/", "motion-beyond-animation", entry_id),
                              ("/api/journal/", "motion-beyond-animation", entry_id)):
        assert get(app_url, prefix + slug).status_code == 200
        variants = [slug.upper(), slug.capitalize(), slug + "/", slug.replace("-", "%2D", 1),
                    "%" + format(ord(slug[0]), "02X") + slug[1:], str(rid)]
        for variant in variants:
            r = get(app_url, prefix + variant)
            assert r.status_code == 404, prefix + variant
            assert not r.has_redirect_location


def test_published_surface_only(app_url: str, studio: Studio) -> None:
    case = studio.make()
    for path in ["/api/nothing-here", "/api/auth/signup", "/api/studio/everything", "/api/cases/hollow-signal/comments"]:
        for method in ("GET", "POST"):
            r = call(app_url, method, path, body={} if method == "POST" else None)
            assert r.status_code == 404, (method, path)
            assert r.headers["content-type"].startswith("application/json")
            assert r.json() == {"error": "Not found."}
    for path in ["/cart", "/checkout", "/newsletter", "/search", "/app.py", "/run.json", "/requirements.txt", "/.env"]:
        assert get(app_url, path).status_code == 404, path
    for method, path, allowed in (("DELETE", "/api/cases", {"GET"}), ("GET", "/api/auth/login", {"POST"}),
                                  ("PUT", f"/api/studio/cases/{case['id']}", {"PATCH", "DELETE"}),
                                  ("POST", "/api/health", {"GET"}), ("GET", "/api/inquiries", {"POST"})):
        r = call(app_url, method, path)
        assert r.status_code == 405, (method, path)
        assert r.json() == {"error": "Method not allowed."}
        allow = {m.strip().upper() for m in r.headers.get("allow", "").split(",")}
        assert allowed <= allow and method not in allow, (path, allow)


def test_wf_draft_denied_shared_link(browser, app_url: str) -> None:
    assert get(app_url, f"/work/{DRAFT_SLUG}").status_code == 404
    with open_app(browser, f"{app_url}/work/{DRAFT_SLUG}") as page:
        cover_gone(page)
        expect(page.get_by_role("heading", name="Nothing at this address.")).to_be_visible()
        expect(page.get_by_role("navigation", name="Main")).to_be_attached()
        expect(page.get_by_role("link", name="Ivo Kastrel")).to_be_visible()
        expect(page.locator("body")).not_to_contain_text(SEED_TITLES[DRAFT_SLUG])
        expect(page.get_by_role("link", name="Back to the home page")).to_have_attribute("href", href("/"))


def test_wf_draft_denied_not_found_page(browser, app_url: str) -> None:
    probe = f"/nowhere-{uuid.uuid4().hex[:8]}"
    assert get(app_url, probe).status_code == 404
    with open_app(browser, app_url + probe) as page:
        cover_gone(page)
        expect(page.get_by_role("heading", name="Nothing at this address.")).to_be_visible()
        expect(page.get_by_role("link", name="Ivo Kastrel")).to_be_visible()
        expect(page.get_by_role("button", name="Let's Connect")).to_be_visible()
        click(page.get_by_role("link", name="Back to the home page"))
        at_url(page, app_url + "/")


def test_new_case_is_draft(app_url: str, pg: Postgres, studio: Studio) -> None:
    case = studio.make()
    assert case["published"] is False and case["published_at"] is None
    assert pg.rows(f"SELECT published, published_at FROM case_studies WHERE id = {int(case['id'])}") == [{"published": False, "published_at": None}]
    assert case["slug"] in [r["slug"] for r in studio.rows()]
    assert case["slug"] not in [c["slug"] for c in public_cases(app_url)]
    assert case["slug"] not in [c["slug"] for c in public_cases(app_url, "?discipline=ui-ux")]
    assert get(app_url, f"/api/cases/{case['slug']}").status_code == 404
    assert get(app_url, f"/work/{case['slug']}").status_code == 404
    assert case["title"] not in get(app_url, "/work").text


def test_publish_and_unpublish(app_url: str, pg: Postgres, studio: Studio) -> None:
    before = public_cases(app_url)
    case = studio.make(featured=True)
    slug = case["slug"]
    forged = "forged-" + uuid.uuid4().hex
    for token in (None, forged):
        r = call(app_url, "POST", f"/api/studio/cases/{case['id']}/publish", token, {"published": True, "role": "owner"})
        assert r.status_code == 401 and r.json() == {"error": "Sign in to continue."}
    assert pg.rows(f"SELECT published, published_at FROM case_studies WHERE id = {int(case['id'])}") == [{"published": False, "published_at": None}]
    assert slug not in [c["slug"] for c in public_cases(app_url)]
    r = studio.publish(case["id"])
    assert r.status_code == 200
    assert r.json()["published"] is True and r.json()["published_at"]
    db = pg.rows(f"SELECT published, published_at FROM case_studies WHERE id = {int(case['id'])}")[0]
    assert db["published"] is True and db["published_at"] is not None
    listing = public_cases(app_url)
    assert [c["slug"] for c in listing] == [c["slug"] for c in before] + [slug]
    assert listing[-1]["ordinal"] == two(len(before) + 1)
    assert detail(app_url, slug)["total"] == two(len(listing))
    first = detail(app_url, listing[0]["slug"])
    assert first["total"] == two(len(listing)) and first["previous"]["slug"] == slug
    assert detail(app_url, before[-1]["slug"])["next"]["slug"] == slug
    assert slug in [c["slug"] for c in public_cases(app_url, "?discipline=ui-ux")]
    assert case["title"] in get(app_url, "/work").text
    for method, path, body in (("POST", f"/api/studio/cases/{case['id']}/publish", {"published": False}),
                               ("DELETE", f"/api/studio/cases/{case['id']}", None)):
        assert call(app_url, method, path, None, body).status_code == 401
    assert pg.rows(f"SELECT published FROM case_studies WHERE id = {int(case['id'])}") == [{"published": True}]
    assert slug in [c["slug"] for c in public_cases(app_url)]
    assert re.search(rf'href=["\'](?:https?://[^/"\']+)?/work/{slug}["\']', get(app_url, "/").text)
    r = studio.publish(case["id"], False)
    assert r.status_code == 200
    assert r.json()["published"] is False and r.json()["published_at"] is None
    assert pg.rows(f"SELECT published_at FROM case_studies WHERE id = {int(case['id'])}") == [{"published_at": None}]
    assert [c["slug"] for c in public_cases(app_url)] == [c["slug"] for c in before]
    first = detail(app_url, before[0]["slug"])
    assert first["total"] == two(len(before)) and first["previous"]["slug"] == before[-1]["slug"]
    assert detail(app_url, before[-1]["slug"])["next"]["slug"] == before[0]["slug"]
    assert get(app_url, f"/api/cases/{slug}").status_code == 404
    assert case["title"] not in get(app_url, "/work").text
    assert f"/work/{slug}" not in get(app_url, "/").text


def test_guarded_publish_transitions(app_url: str, pg: Postgres, studio: Studio) -> None:
    live = studio.make()
    assert studio.publish(live["id"]).status_code == 200
    stamp = pg.rows(f"SELECT published_at::text AS p FROM case_studies WHERE id = {int(live['id'])}")[0]["p"]
    again = studio.publish(live["id"])
    assert again.status_code == 409
    assert again.json() == {"error": "This case study is already published."}
    assert pg.rows(f"SELECT published_at::text AS p FROM case_studies WHERE id = {int(live['id'])}")[0]["p"] == stamp
    draft = studio.make()
    back = studio.publish(draft["id"], False)
    assert back.status_code == 409
    assert back.json() == {"error": "This case study is already a draft."}
    assert pg.rows(f"SELECT published, published_at FROM case_studies WHERE id = {int(draft['id'])}") == [{"published": False, "published_at": None}]
    race = studio.make()
    results = together(4, lambda _: studio.publish(race["id"]))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    winner = next(r for r in results if r.status_code == 200).json()
    stored = pg.rows(f"SELECT published, extract(epoch FROM published_at)::float AS e FROM case_studies WHERE id = {int(race['id'])}")[0]
    assert stored["published"] is True
    assert abs(datetime.fromisoformat(winner["published_at"].replace("Z", "+00:00")).timestamp() - stored["e"]) <= 1


def test_publish_needs_summary_and_outcome(app_url: str, pg: Postgres, studio: Studio) -> None:
    no_summary = studio.make(summary="   ")
    r = studio.publish(no_summary["id"])
    assert r.status_code == 422 and r.json()["errors"]["summary"] == "Add a summary before publishing."
    no_outcome = studio.make(outcome="")
    r = studio.publish(no_outcome["id"])
    assert r.status_code == 422 and r.json()["errors"]["outcome"] == "Add an outcome before publishing."
    for case in (no_summary, no_outcome):
        assert pg.rows(f"SELECT published, published_at FROM case_studies WHERE id = {int(case['id'])}") == [{"published": False, "published_at": None}]
    live = studio.make()
    assert studio.publish(live["id"]).status_code == 200
    for key in ("summary", "outcome"):
        r = studio.call("PATCH", f"/api/studio/cases/{live['id']}", {key: "  "})
        assert r.status_code == 422 and key in r.json()["errors"]
    row = pg.rows(f"SELECT summary, outcome, published FROM case_studies WHERE id = {int(live['id'])}")[0]
    assert row == {"summary": live["summary"], "outcome": live["outcome"], "published": True}


def test_delete_case(app_url: str, pg: Postgres, studio: Studio) -> None:
    case = studio.make()
    assert studio.publish(case["id"]).status_code == 200
    r = studio.call("DELETE", f"/api/studio/cases/{case['id']}")
    assert r.status_code == 204 and r.content == b""
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE id = {int(case['id'])}") == 0
    assert case["slug"] not in [row["slug"] for row in studio.rows()]
    assert case["slug"] not in [c["slug"] for c in public_cases(app_url)]
    assert get(app_url, f"/api/cases/{case['slug']}").status_code == 404
    assert get(app_url, f"/work/{case['slug']}").status_code == 404
    assert studio.call("DELETE", f"/api/studio/cases/{case['id']}").status_code == 404
    assert studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"title": "Ghost"}).status_code == 404


def test_wf_owner_publishes_curate(browser, app_url: str, pg: Postgres, studio: Studio) -> None:
    fields = draft_fields()
    studio.slugs.append(fields["slug"])
    title, slug = fields["title"], fields["slug"]
    before = public_cases(app_url)
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        status = page.get_by_role("status", name="Studio status")
        click(page.get_by_role("button", name="Create draft"))
        form = page.get_by_role("form", name="Case study editor")
        fill_editor(form, fields)
        click(form.get_by_role("button", name="Save draft"))
        see(page, lambda: expect(status).to_contain_text("Draft created.", timeout=QUICK_MS))
        see(page, lambda: expect(studio_row(page, title)).to_contain_text("Draft", timeout=QUICK_MS))
        assert pg.rows(f"SELECT published, published_at FROM case_studies WHERE slug = {q(slug)}") == [{"published": False, "published_at": None}]
        assert slug not in [c["slug"] for c in public_cases(app_url)]
        assert title not in get(app_url, "/work").text
        click(page.get_by_role("button", name=f"Publish {title}", exact=True))
        see(page, lambda: expect(status).to_contain_text("Published.", timeout=QUICK_MS))
        see(page, lambda: expect(studio_row(page, title)).to_contain_text("Published", timeout=QUICK_MS))
        listing = public_cases(app_url)
        entry = next(c for c in listing if c["slug"] == slug)
        assert entry["ordinal"] == two(len(before) + 1)
        assert title in get(app_url, "/work").text
        click(page.get_by_role("button", name=f"Unpublish {title}", exact=True))
        see(page, lambda: expect(status).to_contain_text("Unpublished.", timeout=QUICK_MS))
        assert slug not in [c["slug"] for c in public_cases(app_url)]
        renamed = f"Renamed Study {uuid.uuid4().hex[:6]}"
        click(page.get_by_role("button", name=f"Edit {title}", exact=True))
        fill(field_of(form, "Title"), renamed)
        click(form.get_by_role("button", name="Save", exact=True))
        see(page, lambda: expect(status).to_contain_text("Saved.", timeout=QUICK_MS))
        assert pg.rows(f"SELECT title FROM case_studies WHERE slug = {q(slug)}") == [{"title": renamed}]
        click(page.get_by_role("button", name=f"Delete {renamed}", exact=True))
        see(page, lambda: expect(status).to_contain_text("Deleted.", timeout=QUICK_MS))
        see(page, lambda: expect(page.get_by_role("button", name=f"Edit {renamed}", exact=True)).to_have_count(0, timeout=QUICK_MS))
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 0


def test_wf_owner_publishes_featured_home(browser, app_url: str, pg: Postgres, studio: Studio) -> None:
    fields = draft_fields(featured=True, discipline="3d-web")
    studio.slugs.append(fields["slug"])
    title, slug = fields["title"], fields["slug"]
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        status = page.get_by_role("status", name="Studio status")
        click(page.get_by_role("button", name="Create draft"))
        form = page.get_by_role("form", name="Case study editor")
        fill_editor(form, fields)
        click(form.get_by_role("button", name="Save draft"))
        see(page, lambda: expect(status).to_contain_text("Draft created.", timeout=QUICK_MS))
        assert pg.rows(f"SELECT featured, discipline FROM case_studies WHERE slug = {q(slug)}") == [{"featured": True, "discipline": "3d-web"}]
        click(page.get_by_role("button", name=f"Publish {title}", exact=True))
        see(page, lambda: expect(status).to_contain_text("Published.", timeout=QUICK_MS))
        visitor = page.context.browser.new_context()
        try:
            home = visitor.new_page()
            home.goto(app_url + "/")
            expect(home.get_by_role("link", name=re.compile(re.escape(title))).first).to_have_attribute("href", href(f"/work/{slug}"))
            click(page.get_by_role("button", name=f"Delete {title}", exact=True))
            see(page, lambda: expect(status).to_contain_text("Deleted.", timeout=QUICK_MS))
            home.reload()
            expect(home.get_by_role("link", name=re.compile(re.escape(title)))).to_have_count(0)
        finally:
            visitor.close()
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 0
    assert get(app_url, f"/work/{slug}").status_code == 404


def test_seed_lands_once(app_url: str, pg: Postgres) -> None:
    assert pg.rows("SELECT email, role FROM accounts") == [{"email": OWNER_EMAIL, "role": "owner"}]
    for slug in SEED_TITLES:
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 1, slug
    assert pg.rows("SELECT published FROM case_studies WHERE slug = 'red-meridian'") == [{"published": False}]
    assert pg.rows("SELECT summary FROM case_studies WHERE slug = 'hollow-signal'") == [{"summary": HOLLOW_SUMMARY}]
    journal = pg.rows("SELECT slug, published_on::text AS d, published FROM journal_entries ORDER BY published_on DESC")
    assert [(j["slug"], j["d"], j["published"]) for j in journal] == SEED_JOURNAL
    assert pg.rows("SELECT award, issuer, awarded_on::text AS d FROM recognitions ORDER BY position") == SEED_RECOGNITIONS
    assert pg.rows("SELECT value, label, caption FROM figures ORDER BY position") == SEED_FIGURES
    assert [{"award": r["award"], "issuer": r["issuer"], "d": r["awarded_on"]} for r in get(app_url, "/api/recognitions").json()] == SEED_RECOGNITIONS
    assert get(app_url, "/api/figures").json() == SEED_FIGURES


def test_owner_changes_survive_restart(app_url: str, pg: Postgres, studio: Studio) -> None:
    rows = {r["slug"]: r for r in studio.rows()}
    low, hollow, vanta = rows["low-tide-radio"], rows["hollow-signal"], rows["vanta-atelier"]
    retitled = f"Hollow Signal {uuid.uuid4().hex[:6]}"
    try:
        assert studio.call("DELETE", f"/api/studio/cases/{low['id']}").status_code == 204
        assert studio.call("PATCH", f"/api/studio/cases/{hollow['id']}", {"title": retitled}).status_code == 200
        assert studio.publish(vanta["id"], False).status_code == 200
        with app_copy() as copy:
            slugs = [c["slug"] for c in public_cases(copy)]
            assert "low-tide-radio" not in slugs and "vanta-atelier" not in slugs
            assert detail(copy, "hollow-signal")["title"] == retitled
            assert count(pg, "SELECT count(*) AS n FROM case_studies WHERE slug = 'low-tide-radio'") == 0
            assert pg.rows("SELECT title FROM case_studies WHERE slug = 'hollow-signal'") == [{"title": retitled}]
            assert pg.rows("SELECT published, published_at FROM case_studies WHERE slug = 'vanta-atelier'") == [{"published": False, "published_at": None}]
            for slug in ("hollow-signal", "ember-ledger", "night-cartography", "vanta-atelier", "red-meridian"):
                assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 1, slug
            assert count(pg, "SELECT count(*) AS n FROM accounts") == 1
            assert count(pg, "SELECT count(*) AS n FROM journal_entries") == len(SEED_JOURNAL)
            assert count(pg, "SELECT count(*) AS n FROM recognitions") == len(SEED_RECOGNITIONS)
            assert count(pg, "SELECT count(*) AS n FROM figures") == len(SEED_FIGURES)
    finally:
        token = owner_token(app_url)
        current = {r["slug"]: r for r in call(app_url, "GET", "/api/studio/cases", token).json()}
        if "low-tide-radio" not in current:
            body = {k: low[k] for k in EDITABLE} | {"slug": "low-tide-radio"}
            made = call(app_url, "POST", "/api/studio/cases", token, body)
            call(app_url, "POST", f"/api/studio/cases/{made.json()['id']}/publish", token, {"published": True})
        if current["hollow-signal"]["title"] != hollow["title"]:
            call(app_url, "PATCH", f"/api/studio/cases/{hollow['id']}", token, {"title": hollow["title"]})
        if not current["vanta-atelier"]["published"]:
            call(app_url, "POST", f"/api/studio/cases/{vanta['id']}/publish", token, {"published": True})


def test_postgres_is_the_store(app_url: str, pg: Postgres) -> None:
    assert {t.split(".")[-1] for t in pg.tables()} == TABLES
    inq = create_inquiry(app_url)
    rows = pg.rows(f"SELECT message FROM inquiries WHERE id = {int(inq['id'])}")
    assert rows == [{"message": inq["message"]}]


def test_case_limits_and_types(app_url: str, pg: Postgres, studio: Studio) -> None:
    bad = draft_fields(title="T" * (TITLE_MAX + 1), summary="S" * (SUMMARY_MAX + 1), challenge="C" * (LONG_MAX + 1),
                       stack=7, year=YEAR_MIN - 1, position=0, featured="yes")
    r = studio.call("POST", "/api/studio/cases", bad)
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "Some fields need attention."
    assert body["errors"]["title"] == f"Use at most {TITLE_MAX} characters."
    assert body["errors"]["summary"] == f"Use at most {SUMMARY_MAX} characters."
    assert body["errors"]["challenge"] == f"Use at most {LONG_MAX} characters."
    assert body["errors"]["stack"] == "Use text."
    assert body["errors"]["year"] == f"Use a whole number from {YEAR_MIN} to {YEAR_MAX}."
    assert body["errors"]["position"] == f"Use a whole number from 1 to {POSITION_MAX}."
    assert body["errors"]["featured"] == "Use true or false."
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(bad['slug'])}") == 0
    missing = {k: v for k, v in draft_fields().items() if k not in ("title", "year", "position")}
    r = studio.call("POST", "/api/studio/cases", missing)
    assert r.status_code == 422
    assert {r.json()["errors"][k] for k in ("title", "year", "position")} == {"This field is required."}
    typed = draft_fields(year="2026", position=True, title=None)
    r = studio.call("POST", "/api/studio/cases", typed)
    assert r.status_code == 422
    assert r.json()["errors"]["year"] == "Use a whole number." and r.json()["errors"]["position"] == "Use a whole number."
    assert "title" in r.json()["errors"]
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug IN ({q(missing['slug'])}, {q(typed['slug'])})") == 0
    stars = studio.make(title="  " + "\u2726" * TITLE_MAX + "  ", summary="\u00e9" * SUMMARY_MAX)
    assert pg.rows(f"SELECT title FROM case_studies WHERE id = {int(stars['id'])}") == [{"title": "\u2726" * TITLE_MAX}]
    studio.make(title="\U0001F3AC" * TITLE_MAX)
    accents = draft_fields(title="\u00e9" * (TITLE_MAX + 1))
    r = studio.call("POST", "/api/studio/cases", accents)
    assert r.status_code == 422 and "title" in r.json()["errors"]
    case = studio.make()
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"title": " ", "year": YEAR_MAX + 1, "approach": "A" * (LONG_MAX + 1)})
    assert r.status_code == 422
    assert r.json()["errors"]["title"] == "This field is required."
    assert r.json()["errors"]["year"] == f"Use a whole number from {YEAR_MIN} to {YEAR_MAX}."
    assert r.json()["errors"]["approach"] == f"Use at most {LONG_MAX} characters."
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {})
    assert r.status_code == 422 and r.json()["errors"]["body"] == "Send at least one field to change."
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"summary": None})
    assert r.status_code == 422 and "summary" in r.json()["errors"]
    row = pg.rows(f"SELECT title, year, approach, summary FROM case_studies WHERE id = {int(case['id'])}")[0]
    assert row == {"title": case["title"], "year": case["year"], "approach": case["approach"], "summary": case["summary"]}


def test_slug_shape_and_discipline(app_url: str, pg: Postgres, studio: Studio) -> None:
    tag = uuid.uuid4().hex[:6]
    bad_slugs = [f"Upper-{tag}", f"-lead-{tag}", f"trail-{tag}-", f"double--{tag}", f"with space {tag}", f"under_{tag}"]
    for slug in bad_slugs:
        r = studio.call("POST", "/api/studio/cases", draft_fields(slug=slug))
        assert r.status_code == 422, slug
        assert r.json()["errors"]["slug"] == "Use lowercase letters, digits and single hyphens."
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 0
    too_long = "a" * (SLUG_MAX + 1)
    r = studio.call("POST", "/api/studio/cases", draft_fields(slug=too_long))
    assert r.status_code == 422 and "slug" in r.json()["errors"]
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(too_long)}") == 0
    for discipline in ("design", "3D WEB", "UI-UX"):
        fields = draft_fields(discipline=discipline)
        r = studio.call("POST", "/api/studio/cases", fields)
        assert r.status_code == 422
        assert r.json()["errors"]["discipline"] == "Choose ui-ux, 3d-web or frontend."
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(fields['slug'])}") == 0
    case = studio.make()
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"discipline": "design"})
    assert r.status_code == 422 and "discipline" in r.json()["errors"]
    assert pg.rows(f"SELECT discipline FROM case_studies WHERE id = {int(case['id'])}") == [{"discipline": case["discipline"]}]


def test_editable_fields_only(app_url: str, pg: Postgres, studio: Studio) -> None:
    forbidden = {"published": True, "published_at": "2026-01-01T00:00:00+00:00", "id": 1,
                 "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
                 "ordinal": "01", "total": "05", "role": "owner", "colour": "red"}
    fields = draft_fields(**forbidden)
    r = studio.call("POST", "/api/studio/cases", fields)
    assert r.status_code == 422
    for key in forbidden:
        assert r.json()["errors"][key] == "This field cannot be set.", key
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(fields['slug'])}") == 0
    case = studio.make()
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"slug": case["slug"]})
    assert r.status_code == 422 and r.json()["errors"]["slug"] == "This field cannot be set."
    r = studio.call("PATCH", f"/api/studio/cases/{case['id']}", {"title": "Sneaky title", "published": True, "position": 0})
    assert r.status_code == 422
    assert r.json()["errors"]["published"] == "This field cannot be set." and "position" in r.json()["errors"]
    row = pg.rows(f"SELECT title, slug, published, published_at FROM case_studies WHERE id = {int(case['id'])}")[0]
    assert row == {"title": case["title"], "slug": case["slug"], "published": False, "published_at": None}


def test_slug_conflict(app_url: str, pg: Postgres, studio: Studio) -> None:
    for slug in ("hollow-signal", "red-meridian"):
        r = studio.call("POST", "/api/studio/cases", draft_fields(slug=slug))
        assert r.status_code == 409
        assert r.json() == {"error": "That slug is already in use."}
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(slug)}") == 1


def test_simultaneous_creates(app_url: str, pg: Postgres, studio: Studio) -> None:
    fields = draft_fields()
    studio.slugs.append(fields["slug"])
    results = together(4, lambda _: studio.call("POST", "/api/studio/cases", fields))
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            assert r.json() == {"error": "That slug is already in use."}
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(fields['slug'])}") == 1


def test_wf_invalid_case_input_form_limits(browser, app_url: str, pg: Postgres, studio: Studio) -> None:
    fields = draft_fields()
    studio.slugs.append(fields["slug"])
    long_title = "T" * (TITLE_MAX + 1)
    long_summary = "S" * (SUMMARY_MAX + 1)
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        click(page.get_by_role("button", name="Create draft"))
        form = page.get_by_role("form", name="Case study editor")
        for label, hint in HINTS.items():
            assert field_of(form, label).evaluate(TIED_JS, hint), f"the {label} limit hint is not tied to its field"
        fill_editor(form, {**fields, "title": long_title, "summary": long_summary})
        click(form.get_by_role("button", name="Save draft"))
        errors = page.get_by_role("alert", name="Studio errors")
        see(page, lambda: expect(errors).to_contain_text("Check the highlighted fields.", timeout=QUICK_MS))
        title_box = field_of(form, "Title")
        summary_box = field_of(form, "Summary")
        assert title_box.evaluate(TIED_JS, f"Use at most {TITLE_MAX} characters."), "Title message not tied to Title"
        assert summary_box.evaluate(TIED_JS, f"Use at most {SUMMARY_MAX} characters."), "Summary message not tied to Summary"
        expect(title_box).to_have_value(long_title)
        expect(summary_box).to_have_value(long_summary)
        expect(field_of(form, "Slug")).to_have_value(fields["slug"])
        assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE slug = {q(fields['slug'])}") == 0
        fill(title_box, fields["title"])
        fill(summary_box, fields["summary"])
        click(form.get_by_role("button", name="Save draft"))
        see(page, lambda: expect(page.get_by_role("status", name="Studio status")).to_contain_text("Draft created.", timeout=QUICK_MS))
        assert pg.rows(f"SELECT title FROM case_studies WHERE slug = {q(fields['slug'])}") == [{"title": fields["title"]}]
        click(page.get_by_role("button", name=f"Edit {fields['title']}", exact=True))
        see(page, lambda: shows(form, fields["slug"], "editing does not show the slug"))
        editable = form.get_by_role("textbox", name="Slug")
        if editable.count():
            expect(editable).not_to_be_editable()


def test_wf_invalid_case_input_slug_conflict(browser, app_url: str, pg: Postgres) -> None:
    fields = draft_fields(slug="hollow-signal")
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        click(page.get_by_role("button", name="Create draft"))
        form = page.get_by_role("form", name="Case study editor")
        fill_editor(form, fields)
        click(form.get_by_role("button", name="Save draft"))
        see(page, lambda: expect(page.get_by_role("alert", name="Studio errors")).to_contain_text("That slug is already in use.", timeout=QUICK_MS))
        expect(field_of(form, "Title")).to_have_value(fields["title"])
        expect(field_of(form, "Summary")).to_have_value(fields["summary"])
        expect(field_of(form, "Slug")).to_have_value("hollow-signal")
    assert count(pg, "SELECT count(*) AS n FROM case_studies WHERE slug = 'hollow-signal'") == 1
    assert count(pg, f"SELECT count(*) AS n FROM case_studies WHERE title = {q(fields['title'])}") == 0


def test_published_catalogue_order(app_url: str, studio: Studio) -> None:
    tag = uuid.uuid4().hex[:8]
    later = studio.make(slug=f"t-{tag}-b")
    earlier = studio.make(slug=f"t-{tag}-a")
    assert studio.publish(later["id"]).status_code == 200
    assert studio.publish(earlier["id"]).status_code == 200
    listing = public_cases(app_url)
    slugs = [c["slug"] for c in listing]
    assert slugs[:5] == SEED_PUBLISHED
    assert [c["ordinal"] for c in listing] == [two(i) for i in range(1, len(listing) + 1)]
    assert slugs.index(earlier["slug"]) + 1 == slugs.index(later["slug"])
    for c in listing:
        assert {"slug", "title", "discipline", "summary", "year", "featured", "ordinal"} <= set(c)
    work = html.unescape(get(app_url, "/work").text)
    spots = [work.find(c["title"]) for c in listing]
    assert all(s >= 0 for s in spots) and spots == sorted(spots)
    home = html.unescape(get(app_url, "/").text)
    featured = [home.find(f"/work/{c['slug']}") for c in listing if c["featured"]]
    assert all(s >= 0 for s in featured) and featured == sorted(featured)


def test_contiguous_ordinals(app_url: str, studio: Studio) -> None:
    tag = uuid.uuid4().hex[:8]
    first = studio.make(slug=f"t-{tag}-a")
    second = studio.make(slug=f"t-{tag}-b")
    for case in (first, second):
        assert studio.publish(case["id"]).status_code == 200
    for remove in ("unpublish", "delete"):
        listing = public_cases(app_url)
        place = next(c["ordinal"] for c in listing if c["slug"] == first["slug"])
        rest = [c["slug"] for c in listing if c["slug"] != first["slug"]]
        if remove == "unpublish":
            assert studio.publish(first["id"], False).status_code == 200
        else:
            assert studio.call("DELETE", f"/api/studio/cases/{first['id']}").status_code == 204
        after = public_cases(app_url)
        assert [c["slug"] for c in after] == rest
        assert [c["ordinal"] for c in after] == [two(i) for i in range(1, len(after) + 1)]
        assert next(c["ordinal"] for c in after if c["slug"] == second["slug"]) == place
        if remove == "unpublish":
            assert studio.publish(first["id"]).status_code == 200


def test_place_and_neighbours(app_url: str) -> None:
    listing = public_cases(app_url)
    n = len(listing)
    for i, entry in enumerate(listing):
        d = detail(app_url, entry["slug"])
        for key in ("challenge", "approach", "outcome", "stack"):
            assert isinstance(d[key], str)
        assert d["ordinal"] == entry["ordinal"] == two(i + 1)
        assert d["total"] == two(n)
        assert d["previous"] == {"slug": listing[i - 1]["slug"], "title": listing[i - 1]["title"]}
        assert d["next"] == {"slug": listing[(i + 1) % n]["slug"], "title": listing[(i + 1) % n]["title"]}
    hollow = detail(app_url, "hollow-signal")
    assert hollow["next"]["slug"] == "ember-ledger"
    assert hollow["previous"]["slug"] == listing[-1]["slug"]
    assert hollow["challenge"] and hollow["outcome"]


def test_discipline_filter_api(app_url: str) -> None:
    full = public_cases(app_url)
    for disc in DISCIPLINES:
        sub = public_cases(app_url, f"?discipline={disc}")
        expected = [c for c in full if c["discipline"] == disc]
        assert [(c["slug"], c["ordinal"]) for c in sub] == [(c["slug"], c["ordinal"]) for c in expected]
    assert [c["slug"] for c in public_cases(app_url, "?discipline=3d-web")][:2] == ["hollow-signal", "vanta-atelier"]
    assert [c["ordinal"] for c in public_cases(app_url, "?discipline=ui-ux")][:2] == ["02", "05"]
    for query in ("?discipline=design", "?discipline=", "?discipline=UI-UX", "?discipline=" + quote("3D WEB"),
                  "?discipline=ui-ux&discipline=frontend"):
        r = get(app_url, "/api/cases" + query)
        assert r.status_code == 422, query
        assert r.json()["errors"]["discipline"] == "Choose ui-ux, 3d-web or frontend."


def test_wf_visitor_browses_case_page(browser, app_url: str) -> None:
    hollow = detail(app_url, "hollow-signal")
    with open_app(browser, app_url + "/") as page:
        cover_gone(page)
        click(page.get_by_role("link", name="VIEW", exact=True))
        at_url(page, app_url + "/work")
        main = page.get_by_role("main")
        click(main.get_by_role("link", name=re.compile("Hollow Signal")).first)
        at_url(page, app_url + "/work/hollow-signal")
        see(page, lambda: expect(main).to_contain_text(re.compile(rf"{hollow['ordinal']}\s*/\s*{hollow['total']}"), timeout=QUICK_MS))
        expect(main.get_by_role("link", name=f"Previous: {hollow['previous']['title']}")).to_have_attribute("href", href(f"/work/{hollow['previous']['slug']}"))
        click(main.get_by_role("link", name=f"Next: {SEED_TITLES['ember-ledger']}"))
        at_url(page, app_url + "/work/ember-ledger")
        ember = detail(app_url, "ember-ledger")
        see(page, lambda: expect(page.get_by_role("main")).to_contain_text(re.compile(rf"{ember['ordinal']}\s*/\s*{ember['total']}"), timeout=QUICK_MS))
        click(page.get_by_role("main").get_by_role("link", name="All work"))
        at_url(page, app_url + "/work")


def test_wf_visitor_browses_filter_history(browser, app_url: str) -> None:
    listing = public_cases(app_url)
    shown = {label: [c for c in listing if label == "All" or c["discipline"] == url.split("=")[-1]] for label, url in FILTERS.items()}
    for disc in DISCIPLINES:
        assert [c["slug"] for c in public_cases(app_url, f"?discipline={disc}")] == [c["slug"] for c in shown[DISPLAY[disc]]]
    with open_app(browser, app_url + "/work") as page:
        cover_gone(page)
        main = page.get_by_role("main")
        nav = page.get_by_role("navigation", name="Discipline filter")
        status = page.get_by_role("status", name="Catalogue status")

        def showing(label: str, announced: bool = True) -> None:
            def verify() -> None:
                expect(page).to_have_url(app_url + FILTERS[label], timeout=QUICK_MS)
                for c in listing:
                    if c in shown[label]:
                        expect(main).to_contain_text(c["title"], timeout=QUICK_MS)
                    else:
                        assert not on_screen(main, c["title"]), f"{c['title']} is still on screen under {label}"
                for other in FILTERS:
                    link = nav.get_by_role("link", name=other, exact=True)
                    if other == label:
                        expect(link).to_have_attribute("aria-current", "true", timeout=QUICK_MS)
                    else:
                        expect(link).not_to_have_attribute("aria-current", "true", timeout=QUICK_MS)
                if announced:
                    expect(status).to_have_text(count_copy(len(shown[label])), timeout=QUICK_MS)
            see(page, verify)

        click(nav.get_by_role("link", name="3D WEB", exact=True))
        showing("3D WEB")
        click(nav.get_by_role("link", name="UI/UX", exact=True))
        showing("UI/UX")
        page.go_back()
        showing("3D WEB")
        page.go_back()
        showing("All")
        page.go_forward()
        showing("3D WEB")
        page.reload()
        showing("3D WEB", announced=False)
        page.goto(app_url + BAD_FILTER)
        at_url(page, app_url + "/work")
    r = get(app_url, BAD_FILTER)
    assert r.status_code == 302 and r.next_request is not None
    assert r.next_request.url.path == "/work" and not r.next_request.url.query


def test_empty_discipline(browser, app_url: str, studio: Studio) -> None:
    row = next(r for r in studio.rows() if r["slug"] == "night-cartography")
    assert [c["slug"] for c in public_cases(app_url, "?discipline=frontend")] == ["night-cartography"]
    assert studio.publish(row["id"], False).status_code == 200
    try:
        assert public_cases(app_url, "?discipline=frontend") == []
        with open_app(browser, app_url + "/work?discipline=frontend") as page:
            cover_gone(page)
            main = page.get_by_role("main")
            expect(main).to_contain_text("Nothing here yet.")
            link = main.get_by_role("link", name="See all work")
            expect(link).to_have_attribute("href", href("/work"))
            click(link)
            at_url(page, app_url + "/work")
    finally:
        assert studio.publish(row["id"]).status_code == 200


def test_journal_reads(app_url: str, pg: Postgres) -> None:
    expected = public_journal(pg)
    listing = get(app_url, "/api/journal").json()
    assert [e["slug"] for e in listing] == [e["slug"] for e in expected]
    assert [e["slug"] for e in listing][:3] == ["motion-beyond-animation", "the-psychology-of-dark-interfaces", "designing-experiences-not-websites"]
    for entry, stored in zip(listing, expected):
        assert isinstance(entry["excerpt"], str) and entry["excerpt"].strip()
        assert entry["published_on"] == stored["d"] and entry["title"] == stored["title"]
    one = get(app_url, f"/api/journal/{MOTION_ENTRY}")
    assert one.status_code == 200
    data = one.json()
    stored = pg.rows("SELECT body, excerpt FROM journal_entries WHERE slug = 'motion-beyond-animation'")[0]
    assert data["title"] == "Motion Beyond Animation" and data["published_on"] == "2026-07-01"
    assert data["body"] == stored["body"] and data["excerpt"] == stored["excerpt"]
    assert get(app_url, f"/api/journal/{HIDDEN_ENTRY}").status_code == 404


def test_journal_business_day() -> None:
    with scratch_app() as (base, db):
        days = db.rows("SELECT (now() AT TIME ZONE 'Pacific/Auckland')::date::text AS today, "
                       "((now() AT TIME ZONE 'Pacific/Auckland')::date + 1)::text AS tomorrow")[0]
        live = {"slug": new_slug("-live"), "title": f"Probe Live {uuid.uuid4().hex[:6]}", "day": days["today"]}
        soon = {"slug": new_slug("-soon"), "title": f"Probe Soon {uuid.uuid4().hex[:6]}", "day": days["tomorrow"]}
        for entry in (live, soon):
            add_entry(db, entry)
        listing = get(base, "/api/journal").json()
        slugs = [e["slug"] for e in listing]
        assert slugs and slugs[0] == live["slug"] and listing[0]["published_on"] == live["day"], slugs
        assert soon["slug"] not in slugs
        index = html.unescape(get(base, "/journal").text)
        home = html.unescape(get(base, "/").text)
        assert live["title"] in index and live["title"] in home
        assert soon["title"] not in index and soon["title"] not in home
        own = get(base, f"/journal/{live['slug']}")
        assert own.status_code == 200 and live["title"] in html.unescape(own.text)
        one = get(base, f"/api/journal/{live['slug']}")
        assert one.status_code == 200 and one.json()["title"] == live["title"]
        for prefix in ("/journal/", "/api/journal/"):
            assert get(base, prefix + soon["slug"]).status_code == 404, prefix


def journal_page_checks(page: Page, app_url: str) -> None:
    entry = get(app_url, f"/api/journal/{MOTION_ENTRY}").json()
    main = page.get_by_role("main")
    at_url(page, f"{app_url}/journal/{MOTION_ENTRY}")
    expect(page.get_by_role("heading", name="Motion Beyond Animation")).to_be_visible()
    expect(main).to_contain_text(fmt_date(entry["published_on"]))
    words = re.findall(r"[A-Za-z]{6,}", re.sub(r"<[^>]+>", " ", entry["body"]))
    assert words, f"the seeded body for {entry['slug']} carries no word to look for"
    expect(main).to_contain_text(max(words, key=len))
    click(main.get_by_role("link", name="All journal entries"))
    at_url(page, app_url + "/journal")


def test_wf_visitor_reads_journal_index(browser, app_url: str, pg: Postgres) -> None:
    with open_app(browser, app_url + "/journal") as page:
        cover_gone(page)
        main = page.get_by_role("main")
        for entry in public_journal(pg):
            expect(main.get_by_role("link", name=re.compile(re.escape(entry["title"]))).first).to_have_attribute("href", href(f"/journal/{entry['slug']}"))
        click(main.get_by_role("link", name=re.compile("Motion Beyond Animation")).first)
        journal_page_checks(page, app_url)


def test_wf_visitor_reads_journal_from_home(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        cover_gone(page)
        click(page.get_by_role("link", name=re.compile("Motion Beyond Animation")).first)
        journal_page_checks(page, app_url)


def test_inquiry_stored(app_url: str, pg: Postgres) -> None:
    body = inquiry(project_type="3d-web")
    r = post_json(app_url, "/api/inquiries", body)
    assert r.status_code == 201
    data = r.json()
    assert isinstance(data["id"], int) and data["status"] == "new"
    row = pg.rows(f"SELECT name, email, message, project_type, status, received_at, resolved_at FROM inquiries WHERE id = {data['id']}")[0]
    assert row["status"] == "new" and row["received_at"] is not None and row["resolved_at"] is None
    assert row["name"] == body["name"] and row["email"].lower() == body["email"].lower()
    assert row["message"] == body["message"] and row["project_type"] == "3d-web"
    plain = create_inquiry(app_url)
    assert pg.rows(f"SELECT project_type FROM inquiries WHERE id = {int(plain['id'])}") == [{"project_type": None}]


def test_inquiry_validation(app_url: str, pg: Postgres) -> None:
    marker = uuid.uuid4().hex
    bad = {"name": "", "phone": "abc", "email": f"not-an-email-{marker}", "message": "short",
           "project_type": "design", "budget": "big"}
    r = post_json(app_url, "/api/inquiries", bad)
    assert r.status_code == 422
    errors = r.json()["errors"]
    assert errors["name"] == "This field is required."
    assert "phone" in errors
    assert errors["email"] == "Enter a valid email address."
    assert errors["message"] == f"Use at least {MESSAGE_MIN} characters."
    assert errors["project_type"] == "Choose ui-ux, 3d-web, frontend or other."
    assert errors["budget"] == "This field cannot be set."
    r = post_json(app_url, "/api/inquiries", {})
    assert r.status_code == 422
    assert {r.json()["errors"][k] for k in ("name", "phone", "email", "message")} == {"This field is required."}
    body = inquiry(name="Bad\u0007Name", phone="12345", message="x" * (MESSAGE_MAX + 1))
    r = post_json(app_url, "/api/inquiries", body)
    assert r.status_code == 422
    assert r.json()["errors"]["name"] == "Remove control characters."
    assert r.json()["errors"]["phone"] == f"Use at least {PHONE_MIN} characters."
    assert r.json()["errors"]["message"] == f"Use at most {MESSAGE_MAX} characters."
    other = inquiry(name="N" * (NAME_MAX + 1), phone="555-0100 ext 5", email="a" * EMAIL_MAX + "@example.com")
    r = post_json(app_url, "/api/inquiries", other)
    assert r.status_code == 422
    assert r.json()["errors"]["name"] == f"Use at most {NAME_MAX} characters."
    assert r.json()["errors"]["phone"] == "Use digits, spaces, +, -, ( and ) only."
    assert "email" in r.json()["errors"]
    typed = inquiry(name=5)
    r = post_json(app_url, "/api/inquiries", typed)
    assert r.status_code == 422 and r.json()["errors"]["name"] == "Use text."
    for b in (body, other, typed):
        assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(b['message'])}") == 0
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE email LIKE {q('%' + marker + '%')}") == 0


def test_malformed_requests(app_url: str, pg: Postgres) -> None:
    def sized(target: int) -> tuple[bytes, dict[str, Any]]:
        body = inquiry()
        body["pad"] = ""
        body["pad"] = "x" * (target - len(json.dumps(body)))
        raw = json.dumps(body).encode()
        assert len(raw) == target
        return raw, body

    json_type = {"Content-Type": "application/json"}
    over, over_body = sized(BODY_LIMIT + 1)
    at, _ = sized(BODY_LIMIT)
    cases = [
        (over, json_type, 413, "The request body is larger than 32,768 bytes."),
        (b"{", json_type, 400, "The request body is not a JSON object."),
        (b"[1, 2]", json_type, 400, "The request body is not a JSON object."),
        (b'"hello"', json_type, 400, "The request body is not a JSON object."),
        (json.dumps(inquiry()).encode(), {"Content-Type": "text/plain"}, 415, "Send the request body as application/json."),
    ]
    for content, headers, status, reason in cases:
        r = call(app_url, "POST", "/api/inquiries", content=content, headers=headers)
        assert r.status_code == status, (status, r.text)
        assert r.headers["content-type"].startswith("application/json")
        assert r.json() == {"error": reason}
    assert call(app_url, "POST", "/api/inquiries", content=at, headers=json_type).status_code == 422
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(over_body['message'])}") == 0
    unauth = call(app_url, "POST", "/api/studio/cases", content=over, headers=json_type)
    assert unauth.status_code == 413
    token = owner_token(app_url)
    plain = call(app_url, "POST", "/api/studio/cases", token, content=json.dumps(draft_fields()).encode(), headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415 and plain.json() == {"error": "Send the request body as application/json."}
    charset = inquiry()
    ok = call(app_url, "POST", "/api/inquiries", content=json.dumps(charset).encode(), headers={"Content-Type": "application/json; charset=utf-8"})
    assert ok.status_code == 201


def test_bounded_email_check(app_url: str, pg: Postgres) -> None:
    n = HOSTILE_EMAIL_CHARS
    hostile = {
        "trailing-at": ("a@" + "a." * n)[: n - 1] + "@",
        "long-domain-bang": "a@" + "a" * (n - 3) + "!",
        "dotted-no-tld": ("a@" + "a." * n)[:n],
        "dotted-bang": ("a@" + "a." * n)[: n - 1] + "!",
        "long-local": "a" * (n - len("@example.com")) + "@example.com",
    }
    for label, email in hostile.items():
        assert len(email) == n, label
        body = inquiry(email=email)
        started = time.monotonic()
        r = post_json(app_url, "/api/inquiries", body)
        elapsed = time.monotonic() - started
        assert r.status_code == 422 and "email" in r.json()["errors"], label
        assert elapsed < EMAIL_BUDGET_S, (label, elapsed)
        assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(body['message'])}") == 0, label


def test_wf_visitor_sends_inquiry_contact(browser, app_url: str, pg: Postgres) -> None:
    body = inquiry()
    with open_app(browser, app_url + "/contact") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        cover_gone(page)
        main = page.get_by_role("main")
        status = main.get_by_role("status", name="Inquiry status")
        expect(status).to_have_text("")
        fill_inquiry(main, body)
        select(main.get_by_role("combobox", name="Project type"), "3D WEB")
        submit = main.get_by_role("button", name="Submit")
        with held(page, "**/api/inquiries") as gate:
            click(submit)
            see(page, lambda: expect(submit).to_be_disabled(timeout=QUICK_MS))
            see(page, lambda: expect(status).to_contain_text(SENDING, timeout=QUICK_MS))
            gate.release()
        see(page, lambda: expect(status).to_contain_text(THANKS, timeout=QUICK_MS))
        see(page, lambda: expect(status).to_have_js_property("isConnected", True, timeout=QUICK_MS))
        assert status.evaluate("s => s.contains(document.activeElement)")
        expect(main.get_by_role("textbox", name="Name")).to_have_count(0)
    rows = pg.rows(f"SELECT project_type, status FROM inquiries WHERE message = {q(body['message'])}")
    assert rows == [{"project_type": "3d-web", "status": "new"}]
    assert any(u.split("?")[0].endswith("/api/inquiries") for u in seen)
    assert all(same_origin(u, app_url) for u in seen if not u.startswith(("data:", "blob:")))


def test_wf_visitor_sends_inquiry_rejected(browser, app_url: str, pg: Postgres) -> None:
    for placement in ("contact", "dialog"):
        name, _ = fresh("visitor")
        body = inquiry(email=f"{uuid.uuid4().hex[:8]}@example")
        with open_app(browser, app_url + "/contact") as page:
            cover_gone(page)
            if placement == "dialog":
                click(page.get_by_role("button", name="Let's Connect"))
                scope = page.get_by_role("dialog", name="Let's Connect")
            else:
                scope = page.get_by_role("main")
            fill_inquiry(scope, body)
            click(scope.get_by_role("button", name="Submit"))
            alert = scope.get_by_role("alert", name="Inquiry errors")
            see(page, lambda: expect(alert).to_contain_text("Check the highlighted fields.", timeout=QUICK_MS))
            expect(alert.get_by_role("link")).to_have_count(1)
            email = scope.get_by_role("textbox", name="Email")
            see(page, lambda: assert_marked_invalid(email))
            expect(scope).to_contain_text("Enter a valid email address.")
            expect(scope.get_by_role("textbox", name="Name")).to_have_value(body["name"])
            expect(scope.get_by_role("textbox", name="Phone")).to_have_value(body["phone"])
            expect(email).to_have_value(body["email"])
            expect(scope.get_by_role("textbox", name="Message")).to_have_value(body["message"])
            click(alert.get_by_role("link").first)
            see(page, lambda: expect(email).to_be_focused(timeout=QUICK_MS))
        assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(body['message'])}") == 0, placement


def test_messages_stay_private(app_url: str) -> None:
    inq = create_inquiry(app_url)
    for path in ["/api/cases", "/api/journal", "/api/recognitions", "/api/figures", "/api/cases/hollow-signal",
                 "/", "/work", "/journal", "/contact", "/work/hollow-signal", "/journal/motion-beyond-animation", "/studio/login"]:
        text = get(app_url, path).text
        assert inq["message"] not in text and inq["email"] not in text, path


def test_duplicate_inquiry_window(app_url: str, pg: Postgres) -> None:
    body = inquiry()
    first = post_json(app_url, "/api/inquiries", body)
    assert first.status_code == 201
    original = first.json()["id"]
    again = post_json(app_url, "/api/inquiries", body)
    assert again.status_code == 200 and again.json() == {"id": original, "status": "new"}
    variant = dict(body, email=body["email"].upper(), message=f"  {body['message']}  ")
    assert post_json(app_url, "/api/inquiries", variant).json()["id"] == original
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(body['message'])}") == 1
    burst = inquiry()
    results = together(4, lambda _: post_json(app_url, "/api/inquiries", burst))
    assert sorted(r.status_code for r in results) == [200, 200, 200, 201]
    assert len({r.json()["id"] for r in results}) == 1
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(burst['message'])}") == 1
    different = post_json(app_url, "/api/inquiries", dict(body, message=f"Another probe {uuid.uuid4().hex} message."))
    assert different.status_code == 201 and different.json()["id"] != original
    wait_db(pg, f"SELECT now() >= received_at + make_interval(secs => {DUPLICATE_WINDOW_S}) AS ok FROM inquiries WHERE id = {int(original)}",
            seconds=DUPLICATE_WINDOW_S + WAIT_S)
    later = post_json(app_url, "/api/inquiries", body)
    assert later.status_code == 201 and later.json()["id"] != original
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(body['message'])}") == 2


def test_guarded_resolve(app_url: str, pg: Postgres, studio: Studio) -> None:
    older = create_inquiry(app_url)
    newer = create_inquiry(app_url)
    r = studio.call("GET", "/api/studio/inquiries")
    assert r.status_code == 200
    rows = r.json()
    keys = [(datetime.fromisoformat(x["received_at"]), x["id"]) for x in rows]
    assert keys == sorted(keys, reverse=True)
    ids = [x["id"] for x in rows]
    assert ids.index(newer["id"]) < ids.index(older["id"])
    mine = next(x for x in rows if x["id"] == older["id"])
    assert {"name", "phone", "email", "message", "project_type", "status", "received_at", "resolved_at"} <= set(mine)
    done = studio.call("POST", f"/api/studio/inquiries/{older['id']}/resolve")
    assert done.status_code == 200
    assert done.json()["status"] == "resolved" and done.json()["resolved_at"]
    stamp = pg.rows(f"SELECT status, resolved_at::text AS r FROM inquiries WHERE id = {int(older['id'])}")[0]
    assert stamp["status"] == "resolved" and stamp["r"]
    again = studio.call("POST", f"/api/studio/inquiries/{older['id']}/resolve")
    assert again.status_code == 409 and again.json() == {"error": "This inquiry is already resolved."}
    assert pg.rows(f"SELECT resolved_at::text AS r FROM inquiries WHERE id = {int(older['id'])}")[0]["r"] == stamp["r"]
    results = together(4, lambda _: studio.call("POST", f"/api/studio/inquiries/{newer['id']}/resolve"))
    assert sorted(x.status_code for x in results) == [200, 409, 409, 409]
    assert pg.rows(f"SELECT status FROM inquiries WHERE id = {int(newer['id'])}") == [{"status": "resolved"}]
    assert studio.call("POST", "/api/studio/inquiries/2147483647/resolve").status_code == 404
    assert studio.call("POST", "/api/studio/inquiries/abc/resolve").status_code == 404


def test_wf_inquiry_inbox_resolve(browser, app_url: str, pg: Postgres) -> None:
    inq = create_inquiry(app_url)
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        inbox = page.get_by_role("region", name="Inquiries", exact=True)
        button = inbox.get_by_role("button", name=f"Mark resolved {inq['name']}", exact=True)
        see(page, lambda: expect(button).to_be_visible(timeout=QUICK_MS))
        expect(inbox.get_by_role("button", name=re.compile(r"^Mark resolved")).first).to_have_accessible_name(f"Mark resolved {inq['name']}")
        click(button)
        see(page, lambda: expect(page.get_by_role("status", name="Studio status")).to_contain_text("Marked resolved.", timeout=QUICK_MS))
        see(page, lambda: expect(button).to_have_count(0, timeout=QUICK_MS))
    row = pg.rows(f"SELECT status, resolved_at FROM inquiries WHERE id = {int(inq['id'])}")[0]
    assert row["status"] == "resolved" and row["resolved_at"] is not None


def test_wf_inquiry_inbox_stale_tab(browser, app_url: str, pg: Postgres) -> None:
    inq = create_inquiry(app_url)
    with open_app(browser, app_url + "/studio/login") as page:
        sign_in_ui(page, app_url)
        inbox = page.get_by_role("region", name="Inquiries", exact=True)
        button = inbox.get_by_role("button", name=f"Mark resolved {inq['name']}", exact=True)
        see(page, lambda: expect(button).to_be_visible(timeout=QUICK_MS))
        elsewhere = call(app_url, "POST", f"/api/studio/inquiries/{inq['id']}/resolve", owner_token(app_url))
        assert elsewhere.status_code == 200
        first = pg.rows(f"SELECT resolved_at::text AS r FROM inquiries WHERE id = {int(inq['id'])}")[0]["r"]
        click(button)
        see(page, lambda: expect(page.get_by_role("alert", name="Studio errors")).to_contain_text("This inquiry is already resolved.", timeout=QUICK_MS))
        see(page, lambda: expect(button).to_have_count(0, timeout=QUICK_MS))
        expect(inbox).to_contain_text("Resolved")
    assert pg.rows(f"SELECT resolved_at::text AS r FROM inquiries WHERE id = {int(inq['id'])}")[0]["r"] == first


def test_server_rendered_home(browser) -> None:
    value = f"{uuid.uuid4().int % 900 + 100}+"
    label = f"Probe figure {uuid.uuid4().hex[:6]}"
    with scratch_app() as (base, db):
        db.run(f"UPDATE figures SET value = {q(value)}, label = {q(label)} WHERE position = (SELECT min(position) FROM figures)")
        figures = db.rows("SELECT value, label FROM figures ORDER BY position")
        assert figures[0] == {"value": value, "label": label}
        raw = get(base, "/").text
        for anchor in ANCHORS:
            assert re.search(rf'id=["\']?{anchor}["\'\s>]', raw), anchor
        flat = squash(html.unescape(re.sub(r"<[^>]+>", "", raw)))
        assert squash(STATEMENT) in flat
        for fig in figures:
            assert squash(fig["value"]) in flat and squash(fig["label"]) in flat, fig
        linked = set(re.findall(r'href=["\'](?:https?://[^/"\']+)?/work/([^"\'?#/]+)["\']', raw))
        assert linked == {c["slug"] for c in public_cases(base) if c["featured"]}
        context = browser.new_context(java_script_enabled=False)
        try:
            page = context.new_page()
            page.goto(base + "/")
            expect(statement(page)).to_be_visible()
            for fig in figures:
                expect(page.get_by_text(fig["value"]).first).to_be_visible()
        finally:
            context.close()


def test_home_chapters(browser) -> None:
    award = f"Probe Award {uuid.uuid4().hex[:6]}"
    caption = f"Probe caption {uuid.uuid4().hex[:6]}."
    with scratch_app() as (base, db):
        db.run(f"UPDATE recognitions SET award = {q(award)}, awarded_on = '2026-02-03' "
               "WHERE position = (SELECT max(position) FROM recognitions)")
        db.run(f"UPDATE figures SET caption = {q(caption)} WHERE position = (SELECT max(position) FROM figures)")
        figures = db.rows("SELECT value, label, caption FROM figures ORDER BY position")
        recognitions = db.rows("SELECT award, issuer, awarded_on::text AS d FROM recognitions ORDER BY position")
        assert figures[-1]["caption"] == caption and recognitions[-1]["award"] == award
        featured = [c["title"] for c in public_cases(base) if c["featured"]]
        newest = public_journal(db)[:3]
        with open_app(browser, base + "/") as page:
            cover_gone(page)
            assert page.evaluate(ORDER_JS, ANCHORS)
            text = {a: squash(page.evaluate(TEXT_JS, a)) for a in ANCHORS}
    for phrase in [STATEMENT, INTRO, *ROLES]:
        assert squash(phrase) in text["hero"], phrase
    assert squash(ABOUT) in text["about"]
    for fig in figures:
        for value in fig.values():
            assert squash(value) in text["about"], value
    for phrase in [*SKILLS_3D, *DISPLAY.values()]:
        assert squash(phrase) in text["services"], phrase
    spots = [text["work"].find(squash(t)) for t in featured]
    assert all(s >= 0 for s in spots) and spots == sorted(spots)
    for step, paragraph in PROCESS.items():
        assert squash(step) in text["process"] and squash(paragraph) in text["process"], step
    assert squash(CLOSING) in text["process"]
    assert squash("JOURNAL") in text["journal"] and squash(JOURNAL_INTRO) in text["journal"]
    for entry in newest:
        assert squash(entry["title"]) in text["journal"] and squash(fmt_date(entry["d"])) in text["journal"]
    assert squash(AWARDS_HEADING) in text["awards"] and squash(AWARDS_INTRO) in text["awards"]
    for rec in recognitions:
        for phrase in (rec["award"], rec["issuer"], fmt_date(rec["d"])):
            assert squash(phrase) in text["awards"], phrase
    assert squash("GET IN TOUCH") in text["contact"] and squash("LET'S BE CREATIVE") in text["contact"]


def test_site_chrome(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        for path in PUBLIC_PAGES:
            page.goto(app_url + path)
            cover_gone(page)
            expect(page.get_by_role("link", name="Ivo Kastrel").first).to_have_attribute("href", href("/"))
            nav = page.get_by_role("navigation", name="Main")
            for name, target in NAV_LINKS:
                expect(nav.get_by_role("link", name=name, exact=True)).to_have_attribute("href", href(target))
            expect(page.get_by_text(re.compile(r"^\s*ONLINE\s*$", re.I)).first).to_be_visible()
            expect(page.get_by_role("button", name="Let's Connect")).to_be_visible()
            expect(page.get_by_role("button", name="Motion")).to_have_attribute("aria-pressed", re.compile("true|false"))
            for word in ("TENSION", "IMMERSION", "IMPACT"):
                expect(page.get_by_text(word).first).to_be_attached()
            expect(page.get_by_role("link", name="Studio", exact=True)).to_have_attribute("href", href("/studio/login"))


def test_document_metadata(app_url: str) -> None:
    titles = {
        "/": "Ivo Kastrel - Front-End Developer, UI/UX Designer and 3D Web Developer",
        "/work": "Ivo Kastrel - Work",
        "/journal": "Ivo Kastrel - Journal",
        "/contact": "Ivo Kastrel - Contact",
        "/work/hollow-signal": f"{detail(app_url, 'hollow-signal')['title']} - Ivo Kastrel",
    }
    for path, title in titles.items():
        head = Head()
        head.feed(get(app_url, path).text)
        assert head.title.strip() == title, path
        assert head.lang == "en"
        assert head.meta.get("viewport") == VIEWPORT_META
        assert head.meta.get("description") == DESCRIPTION


def test_wf_home_page_first_look(browser, app_url: str) -> None:
    listing = public_cases(app_url)
    with open_app(browser, app_url + "/") as page:
        assert page.evaluate(COVER_JS), "intro cover over the first page"
        cover_gone(page, seconds=COVER_GONE_S)
        click(page.get_by_role("link", name="VIEW", exact=True))
        at_url(page, app_url + "/work")
        assert not page.evaluate(COVER_JS)
        advance(page, STEP_MS)
        assert not page.evaluate(COVER_JS)
        main = page.get_by_role("main")
        for c in listing:
            expect(main).to_contain_text(c["title"])
        expect(main).to_contain_text("01")


def test_wf_home_page_panel(browser, app_url: str, pg: Postgres) -> None:
    body = inquiry()
    with open_app(browser, app_url + "/") as page:
        cover_gone(page)
        opener = page.get_by_role("button", name="Let's Connect")
        click(opener)
        dialog = page.get_by_role("dialog", name="Let's Connect")
        see(page, lambda: expect(dialog.get_by_role("textbox", name="Name")).to_be_focused(timeout=QUICK_MS))
        for key in ["Tab"] * 14 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), key
        fill_inquiry(dialog, body)
        click(dialog.get_by_role("button", name="Submit"))
        status = dialog.get_by_role("status", name="Inquiry status")
        see(page, lambda: expect(status).to_contain_text(THANKS, timeout=QUICK_MS))
        assert status.evaluate("s => s.contains(document.activeElement)")
        page.keyboard.press("Escape")
        see(page, lambda: expect(opener).to_be_focused(timeout=QUICK_MS))
        click(opener)
        see(page, lambda: expect(dialog.get_by_role("textbox", name="Name")).to_have_value("", timeout=QUICK_MS))
        expect(status).not_to_contain_text(THANKS)
        expect(dialog.get_by_role("alert", name="Inquiry errors")).not_to_contain_text("Check the highlighted fields.")
    assert count(pg, f"SELECT count(*) AS n FROM inquiries WHERE message = {q(body['message'])}") == 1


def test_reduced_motion(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        cover_gone(page)
        stmt = statement(page)
        bottom = int(page.evaluate(HERO_BOTTOM_JS))
        motion = page.get_by_role("button", name="Motion")
        for _ in range(3):
            advance(page, STEP_MS)
            assert loops(page) == []
            assert unsettled_headings(page) == []
            lefts = statement_lefts(page, stmt, [0, bottom // 2, bottom, 0])
            assert max(lefts) - min(lefts) <= 1, lefts
            click(motion)


def test_motion_toggle(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        cover_gone(page)
        motion = page.get_by_role("button", name="Motion")
        expect(motion).to_have_attribute("aria-pressed", "true")
        assert loops(page)
        click(motion)
        see(page, lambda: expect(motion).to_have_attribute("aria-pressed", "false", timeout=QUICK_MS))
        see(page, lambda: (_ for _ in ()).throw(AssertionError("loops")) if loops(page) else None)
        see(page, lambda: (_ for _ in ()).throw(AssertionError(unsettled_headings(page))) if unsettled_headings(page) else None)
        page.reload()
        expect(page.get_by_role("button", name="Motion")).to_have_attribute("aria-pressed", "false")
        assert loops(page) == []
        tab = page.context.new_page()
        tab.goto(app_url + "/")
        cover_gone(tab)
        expect(tab.get_by_role("button", name="Motion")).to_have_attribute("aria-pressed", "false")
        assert loops(tab) == []


def test_split_heading_reveal(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        heading = page.get_by_role("heading", name=re.compile(rf"^\s*{re.escape(AWARDS_HEADING)}\s*$", re.I))
        expect(heading).to_have_count(1)
        heading.scroll_into_view_if_needed()
        samples: list[dict[str, Any]] = []
        clock = 0
        while True:
            sample = heading.evaluate(WORDS_JS)
            sample["clock"] = clock
            samples.append(sample)
            if clock >= 2 * REVEAL_MAX_MS and heading.evaluate(SETTLED_JS):
                break
            assert clock < UI_DEADLINE_S * 1000, "heading never settled"
            advance(page, REVEAL_STEP_MS)
            clock += REVEAL_STEP_MS
    final = samples[-1]["words"]
    assert len(final) >= 2, final
    assert all(w["opacity"] > 0.99 and w["blur"] < 0.5 for w in final), final
    words = [s["words"] for s in samples]
    assert any(w["blur"] > 0.5 for ws in words for w in ws), "no word came out of a blur"
    assert any(w["moved"] != f["moved"] or abs(w["y"] - f["y"]) > 0.5
               for ws in words for w, f in zip(ws, final)), "no word rose into place"

    def staggered(ws: list[dict[str, Any]]) -> bool:
        opacities = [w["opacity"] for w in ws]
        blurs = [w["blur"] for w in ws]
        rises = [abs(w["y"] - f["y"]) for w, f in zip(ws, final)]
        return (max(opacities) - min(opacities) > 0.05 or max(blurs) - min(blurs) > 0.3
                or len({w["moved"] for w in ws}) > 1 or max(rises) - min(rises) > 0.5)

    assert any(staggered(ws) for ws in words), "words revealed all at once"

    def at_rest(ws: list[dict[str, Any]]) -> bool:
        return all(abs(w["opacity"] - f["opacity"]) < 0.01 and abs(w["blur"] - f["blur"]) < 0.1
                   and w["moved"] == f["moved"] and abs(w["y"] - f["y"]) <= 0.5
                   for w, f in zip(ws, final))

    settled_at = next(i for i in range(len(samples)) if all(at_rest(ws) for ws in words[i:]))
    elapsed = min(samples[settled_at]["clock"], samples[settled_at]["t"] - samples[0]["t"])
    assert elapsed <= REVEAL_MAX_MS, elapsed


def test_hero_statement_follows_scroll(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        stmt = statement(page)
        bottom = int(page.evaluate(HERO_BOTTOM_JS))
        forward = [bottom * i // 4 for i in range(5)]
        ahead = statement_lefts(page, stmt, forward)
        back = statement_lefts(page, stmt, forward[::-1])
        rest = statement_lefts(page, stmt, [forward[2], forward[2]])
    assert all(b <= a + 1 for a, b in zip(ahead, ahead[1:])), ahead
    assert QUARTER_MIN * 1280 <= ahead[0] - ahead[-1] <= QUARTER_MAX * 1280, ahead
    assert all(b >= a - 1 for a, b in zip(back, back[1:])), back
    assert abs(back[-1] - ahead[0]) <= 2
    assert abs(rest[0] - rest[1]) <= 1


def test_living_chrome_loops(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        advance(page, STEP_MS)
        top = loops(page)
        assert top and all(x["zone"] != "other" for x in top), top
        assert len({x["duration"] for x in top if x["zone"] == "motion"}) >= 2
        assert any(PULSE_MIN_MS <= x["duration"] <= PULSE_MAX_MS for x in top if x["zone"] == "pill")
        hero = [x for x in top if x["zone"] == "hero"]
        assert len(hero) >= 2 and any(x["duration"] >= DRIFT_MIN_MS for x in hero)
        assert any(RING_MIN_MS <= x["duration"] <= RING_MAX_MS for x in top if x["zone"] == "rail")
        page.evaluate("() => document.getElementById('process').scrollIntoView({behavior: 'instant'})")
        advance(page, STEP_MS)
        mid = loops(page)
        assert all(x["zone"] != "other" for x in mid), mid
        assert any(RING_MIN_MS <= x["duration"] <= RING_MAX_MS for x in mid if x["zone"] == "process")


def test_wf_cross_cutting_phone(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        desktop = statement(page).evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        page.set_viewport_size({"width": 375, "height": VIEWPORTS[375]})
        page.reload()
        advance(page, STEP_MS)
        phone = statement(page).evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        assert PHONE_RATIO_MIN <= phone / desktop <= PHONE_RATIO_MAX, (phone, desktop)
        for anchor, labels in (("about", [f["value"] for f in SEED_FIGURES]), ("services", list(DISPLAY.values()))):
            rects = page.evaluate(RECTS_JS, [anchor, labels])
            assert all(rects), (anchor, rects)
            for a, b in zip(rects, rects[1:]):
                assert b["top"] > a["top"], (anchor, rects)
                assert a["left"] < b["right"] and b["left"] < a["right"], (anchor, rects)


@pytest.mark.parametrize("path", list(AXE_PAGES.values()), ids=list(AXE_PAGES))
def test_wcag_audit(browser, app_url: str, path: str) -> None:
    with open_app(browser, app_url + path) as page:
        cover_gone(page)
        settle(page.locator("body"))
        axe(page)


@pytest.mark.parametrize("path", list(LAYOUT_PAGES.values()), ids=list(LAYOUT_PAGES))
def test_no_sideways_scrolling(browser, app_url: str, path: str) -> None:
    with open_app(browser, app_url + path) as page:
        if path == "/studio":
            sign_in_ui(page, app_url)
        cover_gone(page)
        for width, height in VIEWPORTS.items():
            page.set_viewport_size({"width": width, "height": height})
            advance(page, STEP_MS)
            layout(page)


def test_wf_cross_cutting_keyboard(browser, app_url: str) -> None:
    with open_app(browser, app_url + "/work") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        for _ in range(25):
            page.keyboard.press("Tab")
            focus = page.evaluate(FOCUS_JS, FOCUS_RING_PX)
            if focus is None:
                continue
            assert focus["ringed"], focus
        page.set_viewport_size({"width": 768, "height": VIEWPORTS[768]})
        page.reload()
        menu = page.get_by_role("button", name="Menu")
        see(page, lambda: expect(menu).to_be_visible(timeout=QUICK_MS))
        expect(menu).to_have_attribute("aria-expanded", "false")
        work = page.get_by_role("navigation", name="Main").get_by_role("link", name="WORK", exact=True)
        assert_folded_away(work)
        click(menu)
        see(page, lambda: expect(menu).to_have_attribute("aria-expanded", "true", timeout=QUICK_MS))
        see(page, lambda: expect(work).to_be_visible(timeout=QUICK_MS))
        page.keyboard.press("Escape")
        see(page, lambda: expect(menu).to_have_attribute("aria-expanded", "false", timeout=QUICK_MS))
        expect(menu).to_be_focused()


def test_journal_cover_brightens(browser, app_url: str) -> None:
    title = re.compile("Motion Beyond Animation", re.I)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": 1280, "height": VIEWPORTS[1280]})
        cover_gone(page)
        link = page.get_by_role("link", name=title).first
        named = link.get_by_role("img")
        cover = named.first if named.count() else link
        main = page.get_by_role("main")
        cover.scroll_into_view_if_needed()
        page.mouse.move(1, 1)
        settle(main)
        rest = decode(capture(cover))
        link.focus()
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        expect(link).to_be_focused()
        settle(main)
        focused = decode(capture(cover))
        changed(rest, focused)
        page.keyboard.press("Tab")
        cover.hover()
        settle(main)
        hovered = decode(capture(cover))
        changed(rest, hovered)
        page.mouse.move(1, 1)
        settle(main)
        back = decode(capture(cover))
        assert difference(rest, back) < difference(rest, hovered)


def test_same_origin_runtime(browser, app_url: str) -> None:
    seen: list[str] = []
    with open_app(browser, app_url + "/") as page:
        page.context.on("request", lambda r: seen.append(r.url))
        cover_gone(page)
        for path in PUBLIC_PAGES:
            page.goto(app_url + path)
            page.evaluate("() => window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'})")
            advance(page, STEP_MS)
        sign_in_ui(page, app_url)
        advance(page, STEP_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert seen and not foreign, foreign


def test_health(app_url: str) -> None:
    r = get(app_url, "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        dead_port = s.getsockname()[1]
    dead = f"postgresql://nobody:nothing@127.0.0.1:{dead_port}/none"
    with app_copy(healthy=False, DATABASE_URL=dead) as copy:
        down = httpx.get(copy + "/api/health", timeout=HTTP_TIMEOUT)
        assert down.status_code == 503 and down.json() == {"status": "unavailable"}


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str)
    serve = manifest["serve"]
    assert "0.0.0.0" in serve
    tokens = re.findall(r"(?:--workers[= ]\s*|-w\s*|WEB_CONCURRENCY=)(\S+)", serve)
    assert tokens, f"serve sets no worker count: {serve}"
    counts = [int(found.group(1)) for token in tokens if (found := re.search(r"(\d+)\s*}?$", token))]
    assert not counts or max(counts) >= 2, f"serve sets fewer than two workers: {serve}"
    for banned in ("flask run", "runserver", "--reload", "--debug"):
        for key in ("install", "build", "serve"):
            assert banned not in manifest[key], (key, banned)
    assert not re.search(r"(?:--bind|--host|-b|-h)[= ]\s*\[?(?:127\.0\.0\.1|localhost|::1)", serve), serve


def shows(scope: Locator, text: str, why: str) -> None:
    assert scope.evaluate(SHOWN_JS, text), why


def on_screen(scope: Locator, text: str) -> bool:
    return any(node.is_visible() for node in scope.get_by_text(text, exact=False).all())


def assert_marked_invalid(field: Locator) -> None:
    assert field.evaluate("e => e.getAttribute('aria-invalid') === 'true' || !e.checkValidity()"), \
        "the refused field is not marked invalid for assistive technology"


def assert_folded_away(locator: Locator) -> None:
    if not locator.is_visible():
        return
    box, size = locator.bounding_box(), locator.page.viewport_size
    assert box and size and (box["x"] + box["width"] <= 1 or box["x"] >= size["width"] - 1), \
        "the folded navigation is on screen before Menu is pressed"


def requirements_file() -> Path:
    install = json.loads(Path("/app/run.json").read_text())["install"]
    named = re.search(r"-r\s+(\S+)", install)
    if not named:
        return Path("/app/requirements.txt")
    path = Path(named.group(1))
    return path if path.is_absolute() else Path("/app") / path


def test_if_user_readme() -> None:
    text = Path("/app/USER_README.md").read_text()
    assert OWNER_EMAIL in text and OWNER_PASSWORD in text


def test_if_no_media_files() -> None:
    media = {".woff", ".woff2", ".ttf", ".otf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
             ".bmp", ".tif", ".tiff", ".svg", ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov", ".glb",
             ".gltf", ".obj", ".fbx"}
    found = [str(p) for p in Path("/app").rglob("*")
             if p.is_file() and p.suffix.lower() in media and not {".venv", ".git", "node_modules"} & set(p.parts)]
    assert not found, found


def test_if_third_party_notices() -> None:
    norm = lambda s: re.sub(r"[-_.]+", "-", s.lower())
    notices = norm(Path("/app/THIRD_PARTY_NOTICES.md").read_text())
    user_site = Path(pwd.getpwuid(Path(DEPLOYED_APP).stat().st_uid).pw_dir) / ".local"
    roots = (Path(DEPLOYED_APP) / ".venv", Path("/app/.venv"), user_site)
    headers = {}
    for root in roots:
        for meta in root.glob("lib/python*/site-packages/*.dist-info/METADATA") if root.exists() else ():
            block = meta.read_text(errors="replace").split("\n\n", 1)[0]
            headers[norm(re.search(r"^Name: (.+)$", block, re.M).group(1).strip())] = block
    assert headers, "no installed package metadata under the deployed app or the user site"
    shipped = set()
    queue = [norm(n) for n in re.findall(r"^\s*([A-Za-z0-9._-]+)", requirements_file().read_text(), re.M)]
    while queue:
        name = queue.pop()
        if name in shipped or name not in headers:
            continue
        shipped.add(name)
        queue += [norm(d) for d in
                  re.findall(r"^Requires-Dist: ([A-Za-z0-9._-]+)(?![^\n]*; *extra)", headers[name], re.M)]
    allowed = re.compile(r"\bMIT\b|BSD|Apache|\bISC\b|PSF|Python Software Foundation"
                         r"|MPL|Mozilla Public|LGPL|Lesser General Public", re.I)
    for name in sorted(shipped):
        licence = " ".join(re.findall(r"^(?:License-Expression|License|Classifier: License ::.*?): ?(.*)$",
                                      headers[name], re.M))
        assert name in notices, name
        if licence.strip():
            assert allowed.search(licence), (name, licence)


def test_if_postgres_only() -> None:
    for root in (Path("/app"), Path(DEPLOYED_APP)):
        files = [str(p) for p in root.rglob("*") if p.is_file() and not {".venv", ".git"} & set(p.parts)
                 and p.suffix.lower() in {".sqlite", ".sqlite3", ".db", ".db3"}]
        assert not files, files
    requirements = requirements_file().read_text().lower()
    for banned in ("redis", "celery", "rq", "kombu", "pymemcache", "pylibmc", "pymongo", "aiosqlite"):
        assert not re.search(rf"^{banned}\b", requirements, re.M), banned
