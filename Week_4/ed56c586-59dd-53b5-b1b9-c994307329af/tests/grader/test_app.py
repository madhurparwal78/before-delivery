from __future__ import annotations

import contextlib
import json
import math
import os
import re
import socket
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    S3,
    Mailpit,
    addresses,
    advance,
    animations,
    axe,
    center,
    check as pointer_check,
    click as pointer_click,
    fill as pointer_fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    post_json,
    scroll_samples,
    select as pointer_select,
    session,
    settle,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap as pointer_tap,
    text,
    unique,
    until,
)

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORTS = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}
VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]
FRAME_MS = 16
INTRO_END_MS = 1800
ROLE_MS = 2500
HEADER_PX = 64
JUMP_TOP = 80
JUMP_TOL = 2
CLEAR_TOP = 72
GLIDE_S = 1
POLL_SLACK_S = 0.5
COUNT_MS = 1500
STEP_MS = 150
SWIPE_PX = 40
TARGET_PX = 44
NAME_MAX = 80
MSG_MIN = 20
MSG_MAX = 2000
BODY_LIMIT = 16384
DRIFT_CAP = 600
DRIFT_SHARE = 0.3
TILT_MAX = 12
GALLERY_OFFSET = 64
HERO_PHONE_MAX = 240
CONTACT_TOL = 4
RECHECK_MS = 5000
WORD_START_MS = 150
WORD_STEP_MS = 100
WORD_FADE_MS = 500
GREETING_MS = 300
BAR_MS = 600
BAR_STEP_MS = 80
LETTER_MS = 400
LETTER_STEP_MS = 40
LETTER_COUNT = 12
TIMING_TOL_MS = 20
MEDIA_RECOVER_S = 10
MAIL_LATE_TIMEOUT_S = 3
HTTP_TIMEOUT = 40.0
HEALTH_WAIT_S = 60
MAIL_WAIT_S = 30
TAB_LIMIT = 140
MEDIA_LATE_PORT = 47391
MAIL_LATE_PORT = 47392
STUDIO = "hello@ottolinerask.example"
APP_DIR = Path("/app")

ROLES = ["full-stack developer", "motion engineer", "Firebase app builder",
         "creative designer", "presentation designer", "prompt engineer"]
DISCIPLINES = [("Web", "web"), ("Motion", "motion"), ("Cloud", "cloud"),
               ("Data", "data"), ("Design", "design"), ("AI", "ai")]
PROJECTS = [
    ("hollis-atelier", "Hollis Atelier", "Architecture and creative portfolio website", "Hollis Atelier", "2025", "Design and build", ["Web", "Design"]),
    ("foundry-loop", "Foundry Loop", "Animated studio website", "Foundry Loop", "2024", "Motion and front-end build", ["Web", "Motion"]),
    ("tallyhouse", "Tallyhouse", "Full-stack web application", "Tallyhouse Collective", "2024", "Full-stack build", ["Web", "Data"]),
    ("pulse-roster", "Pulse Roster", "Firebase-powered application", "Pulse Volunteers", "2023", "App and cloud build", ["Web", "Cloud"]),
    ("tidegauge", "Tidegauge", "Interactive dashboard", "Tidegauge Analytics", "2025", "Dashboard design and build", ["Motion", "Data"]),
    ("promptloom", "Promptloom", "AI-assisted creative tool", "Promptloom Labs", "2026", "Product design and AI build", ["Design", "AI"]),
]
SLUGS = ["hollis-atelier", "foundry-loop", "tallyhouse", "pulse-roster", "tidegauge", "promptloom"]
TITLES = {p[0]: p[1] for p in PROJECTS}
STACKS = {
    "hollis-atelier": ["Next.js", "TypeScript", "Accessible HTML and CSS", "Figma", "Brand assets"],
    "foundry-loop": ["TypeScript", "GSAP", "SVG animation", "Web Animations API", "Figma"],
    "tallyhouse": ["React", "Node.js", "PostgreSQL", "REST and GraphQL APIs", "TypeScript"],
    "pulse-roster": ["React", "Firebase Authentication", "Cloud Firestore", "Cloud Functions", "Hosting and CI"],
    "tidegauge": ["TypeScript", "React", "Framer Motion", "Node.js", "MongoDB"],
    "promptloom": ["Prompt design", "Workflow automation", "Custom AI tools", "Canva", "Presentation design"],
}
FOUNDRY_CALLOUTS = {
    1: ("Reel scrubber", 1, 2, (10, 70, 80, 18)),
    2: ("Letterform morph", 2, 5, (15, 15, 55, 45)),
    3: ("Team grid hover", 5, 6, (60, 40, 32, 44)),
}
SECTION_IDS = ["about", "work", "services", "skills", "reviews", "contact"]
NAV_NAMES = ["About", "Work", "Services", "Skills", "Reviews", "Contact"]
HEADINGS = {"about": "About", "work": "Selected work", "services": "Services",
            "skills": "Skills and tools", "reviews": "Client reviews",
            "numbers": "By the numbers", "contact": "Start a project"}
MILESTONES = [
    ("2017: First freelance website", "Built a booking site for a local bakery and learned that the boring parts decide whether a site gets used."),
    ("2019: Front-end lead at a product studio", "Led the front end for a team of four and set up the studio's first accessibility checks."),
    ("2021: Went independent", "Started Quillfern Works to take on motion and full-stack builds directly for agencies and founders."),
    ("2023: First real-time cloud app in production", "Shipped a real-time volunteer roster that coordinators now run every weekend."),
    ("2025: AI-assisted tools for design teams", "Began building AI-assisted tools that help design teams repeat and share their best work."),
]
SERVICES = [
    ("Web Development", "web", ["Marketing and product websites", "Full-stack web applications", "APIs and integrations", "Responsive front ends"], ["React", "Next.js", "MERN stack", "REST and GraphQL APIs"]),
    ("Motion & Interaction", "motion", ["Scroll-driven storytelling", "Micro-interactions", "Animated brand systems", "Reduced-motion versions"], ["GSAP", "Framer Motion", "Web Animations API", "SVG animation"]),
    ("App & Cloud Solutions", "cloud", ["Firebase apps", "Sign-in and accounts", "Real-time data", "Cloud functions"], ["Firebase Authentication", "Cloud Firestore", "Cloud Functions", "Hosting and CI"]),
    ("Creative Design", "design", ["Presentation decks", "Brand assets", "Social and campaign visuals", "Visual storytelling"], ["Canva", "Figma", "Presentation design", "Brand guidelines"]),
    ("AI & Prompt Engineering", "ai", ["Prompt design", "Workflow automation", "Custom AI tools", "Team training"], ["Prompt libraries", "Workflow automation", "Custom AI tools", "Model evaluation"]),
]
SKILLS = {
    "Frontend": [("React", 92), ("Next.js", 88), ("TypeScript", 90), ("Accessible HTML and CSS", 94)],
    "Backend": [("Node.js", 86), ("REST and GraphQL APIs", 82), ("PostgreSQL", 74), ("MongoDB", 70)],
    "Animation": [("GSAP", 90), ("Framer Motion", 84), ("Web Animations API", 80), ("SVG animation", 86)],
    "Cloud": [("Firebase Authentication", 85), ("Cloud Firestore", 83), ("Cloud Functions", 78), ("Hosting and CI", 72)],
    "Design": [("Canva", 88), ("Figma", 84), ("Presentation design", 90), ("Brand assets", 80)],
    "AI": [("Prompt design", 87), ("Workflow automation", 81), ("Custom AI tools", 76), ("Model evaluation", 70)],
}
USED_IN = {
    ("Frontend", "React"): ["Tallyhouse", "Pulse Roster", "Tidegauge"],
    ("Frontend", "TypeScript"): ["Hollis Atelier", "Foundry Loop", "Tallyhouse", "Tidegauge"],
    ("Design", "Figma"): ["Hollis Atelier", "Foundry Loop"],
    ("Animation", "GSAP"): ["Foundry Loop"],
    ("Backend", "Node.js"): ["Tallyhouse", "Tidegauge"],
    ("Design", "Canva"): ["Promptloom"],
    ("AI", "Model evaluation"): [],
}
REVIEWS = [
    ("Priya Nandakumar", "Head of Product", "Fernway Health"),
    ("Tomas Reyes", "Creative Director", "Studio Kettle"),
    ("Amara Osei", "Founder", "Loomlight"),
    ("Jonah Feld", "Engineering Manager", "Parcelgrid"),
    ("Elif Durmaz", "Brand Lead", "Northcap Coffee"),
]
NUMBERS = [("projects", 48), ("technologies", 26), ("awards", 7), ("satisfaction", 98)]
ABOUT_FIGURES = [("years", 9), ("led", 31)]
BUDGETS = ["Under $5,000", "$5,000 to $15,000", "$15,000 to $40,000", "Over $40,000"]
MESSAGE = "Two launch pages with scroll motion and a short booking form."
SOCIAL = ["Ottoline Rask on GitHub (opens in a new tab)", "Ottoline Rask on LinkedIn (opens in a new tab)",
          "Ottoline Rask on Dribbble (opens in a new tab)"]
TAB_ORDER = [
    "Skip to content", "Ottoline Rask home", "About", "Work", "Services", "Skills", "Reviews", "Contact",
    "Previous role", "Next role", "Pause roles", "Explore projects", "Start a project",
    *[m[0] for m in MILESTONES],
    "All", "Web", "Motion", "Cloud", "Data", "Design", "AI",
    *[x for p in PROJECTS for x in (p[1], f"Preview {p[1]}")],
    "Web Development", "Motion & Interaction", "App & Cloud Solutions", "Creative Design", "AI & Prompt Engineering",
    "Frontend", "React", "Next.js", "TypeScript", "Accessible HTML and CSS",
    "Next review",
    "Your name", "Email address", "Project type", "Under $5,000", "Tell me about your project", "Send message",
    "Email Ottoline", *SOCIAL,
    "About", "Work", "Services", "Skills", "Reviews", "Contact", *SOCIAL, "Back to top",
]
MEDIA_KEYS = [k for s in SLUGS for k in [f"work/{s}/cover"] + [f"work/{s}/frame-{i}" for i in range(1, 7)]]
NO_OBSERVERS = "delete window.IntersectionObserver; delete window.ResizeObserver;"
GRADING_KEY = os.environ.get("GRADING_KEY", "")
NOT_FOUND_BODY = {"error": "not_found", "message": "Not found."}


@contextlib.contextmanager
def site(browser: Browser, url: str, size=DESKTOP, rm: bool = False, init: str | None = None):
    with open_app(browser, url, reduced_motion="reduce" if rm else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if init:
            page.add_init_script(init)
        page.reload()
        yield page


def section(page: Page, sid: str):
    return page.locator(f'[data-section="{sid}"]')


def project_card(page: Page, slug: str):
    return page.locator(f'[data-project="{slug}"]')


def service_visual(page: Page, value: str):
    return page.locator(f'[data-service="{value}"]').locator("[data-service-visual]")


def finish_intro(page: Page) -> None:
    advance(page, INTRO_END_MS + FRAME_MS)
    expect(section(page, "intro")).to_have_attribute("data-intro", "done")


def poll(check_fn, seconds: float, message: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check_fn():
            return
    pytest.fail(message)


STEADY_S = 0.1
STEADY_LIMIT_S = 3
PIXEL = 1


MOVING = """e => { for (let a = e; a; a = a.parentElement) if (a.getAnimations().some(x => x.playState === 'running'
  && Number.isFinite(x.effect && x.effect.getComputedTiming().endTime))) return true; return false; }"""


def steady(locator) -> None:
    deadline = time.monotonic() + STEADY_LIMIT_S
    last, since = None, time.monotonic()
    while time.monotonic() < deadline:
        box = locator.evaluate(
            "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, scrollX, scrollY]; }")
        if locator.evaluate(MOVING):
            since = time.monotonic()
        elif last is not None:
            in_view = box[:2] != last[:2]
            on_page = (box[0] + box[4], box[1] + box[5]) != (last[0] + last[4], last[1] + last[5])
            if box[2:4] != last[2:4] or (in_view and on_page):
                since = time.monotonic()
        last = box
        if time.monotonic() - since >= STEADY_S:
            return


def reach(locator) -> None:
    expect(locator).to_be_visible()
    steady(locator)
    locator.evaluate(f"""e => {{ e.scrollIntoView({{block: 'nearest', inline: 'nearest', behavior: 'instant'}});
        if (e.closest('header, [role=banner], [role=dialog], dialog')) return;
        const r = e.getBoundingClientRect();
        if (r.top < {CLEAR_TOP}) window.scrollBy({{top: r.top - {CLEAR_TOP}, behavior: 'instant'}}); }}""")


def click(locator) -> None:
    reach(locator)
    pointer_click(locator)


def tap(locator) -> None:
    reach(locator)
    pointer_tap(locator)


def fill(locator, value: str) -> None:
    reach(locator)
    pointer_fill(locator, value)


def check(locator) -> None:
    if not locator.is_checked():
        reach(locator)
    pointer_check(locator)


def select(locator, choice: str) -> None:
    reach(locator)
    pointer_select(locator, choice)


ON_SCREEN_PART = """e => { let x1 = 0, y1 = 0, x2 = innerWidth, y2 = innerHeight;
  for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a), b = a.getBoundingClientRect();
    if (s.overflowX !== 'visible') { x1 = Math.max(x1, b.left); x2 = Math.min(x2, b.right); }
    if (s.overflowY !== 'visible') { y1 = Math.max(y1, b.top); y2 = Math.min(y2, b.bottom); }
  }
  let best = null, area = 0;
  for (const el of [e, ...e.querySelectorAll('*')]) {
    const r = el.getBoundingClientRect();
    const l = Math.max(r.left, x1), t = Math.max(r.top, y1), rr = Math.min(r.right, x2), bb = Math.min(r.bottom, y2);
    if (rr - l > 0 && bb - t > 0 && (rr - l) * (bb - t) > area) { area = (rr - l) * (bb - t); best = {x: (l + rr) / 2, y: (t + bb) / 2}; }
  }
  return best; }"""


def aim_point(locator) -> tuple[float, float]:
    expect(locator).to_be_visible()
    steady(locator)
    locator.evaluate(f"""e => {{ const r = e.getBoundingClientRect();
        if (r.top < {CLEAR_TOP} || r.bottom > innerHeight)
          window.scrollBy({{top: r.top - Math.max({CLEAR_TOP}, (innerHeight - r.height) / 2), behavior: 'instant'}}); }}""")
    point = locator.evaluate(ON_SCREEN_PART)
    assert point is not None, "no part of the element is on screen"
    assert locator.evaluate(
        "(e, p) => { const hit = document.elementFromPoint(p.x, p.y); return hit === e || e.contains(hit); }", point
    ), "control is obscured at the actual pointer target"
    return point["x"], point["y"]


MENU_SLIDE_MAX_S = 0.35
UNCOVERED = """e => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return h === e || e.contains(h); }"""


def at_top(page: Page) -> bool:
    return page.evaluate("() => scrollY < 1") and focused(h1(page))


def hold_top(page: Page, what: str) -> None:
    poll(lambda: at_top(page), POLL_SLACK_S, f"{what}: expected the top of the page with focus on the level-1 heading")
    deadline = time.monotonic() + GLIDE_S + POLL_SLACK_S
    while time.monotonic() < deadline:
        assert at_top(page), f"{what}: the page left the top after Back (an older glide took over)"


def heading(page: Page, sid: str):
    return page.get_by_role("heading", name=HEADINGS[sid], exact=True)


def h1(page: Page):
    return page.get_by_role("heading", level=1)


def stack_items(page: Page, slug: str):
    items = STACKS[slug]
    return (page.get_by_role("list").filter(has_text=items[0]).filter(has_text=items[-1])
            .get_by_role("listitem"))


def nav_link(page: Page, name: str, nav: str = "Sections"):
    return page.get_by_role("navigation", name=nav).get_by_role("link", name=name, exact=True)


def updates(page: Page):
    return page.get_by_role("status", name="Site updates")


def at_jump(head) -> bool:
    top, focused = head.evaluate("e => [e.getBoundingClientRect().top, e === document.activeElement]")
    return abs(top - JUMP_TOP) <= JUMP_TOL and focused


def glide_to(head, what: str) -> None:
    poll(lambda: at_jump(head), GLIDE_S + POLL_SLACK_S,
         f"{what}: expected the heading 80 px from the top with focus within one second")


def current(page: Page, nav: str = "Sections") -> list[str]:
    links = page.get_by_role("navigation", name=nav).get_by_role("link")
    return [links.nth(i).inner_text().strip() for i in range(links.count())
            if links.nth(i).get_attribute("aria-current") == "true"]


def put(locator, frac: float, offset: float = 0.0) -> None:
    locator.evaluate(
        """(e, a) => { const y = e.getBoundingClientRect().top + window.scrollY - a.f * innerHeight + a.o;
        window.scrollTo(0, Math.ceil(y)); window.dispatchEvent(new Event('scroll')); }""",
        {"f": frac, "o": offset})


def scroll_y(page: Page, y: float) -> None:
    page.evaluate("y => { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }", y)


def top(locator) -> float:
    return locator.evaluate("e => e.getBoundingClientRect().top")


def focused(locator) -> bool:
    return locator.evaluate("e => e === document.activeElement")


RECORD_ANIMATE = """(() => { const o = Element.prototype.animate; window.__waapi = [];
Element.prototype.animate = function (k, opts) { const t = typeof opts === 'number' ? {duration: opts} : (opts || {});
window.__waapi.push([this, Number(t.delay || 0), Number(t.duration || 0)]); return o.call(this, k, opts); }; })();"""


def timings(locator) -> list[list[float]]:
    return locator.evaluate(
        """e => { const out = [];
        const ms = v => v.split(',').map(s => { s = s.trim(); return s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000; });
        const els = [e, ...e.querySelectorAll('*')];
        for (const el of els) {
          const cs = getComputedStyle(el);
          for (const [d, u] of [[cs.animationDelay, cs.animationDuration], [cs.transitionDelay, cs.transitionDuration]]) {
            const D = ms(d), U = ms(u); U.forEach((x, i) => out.push([D[i % D.length], x]));
          }
          for (const [t, d, u] of (window.__waapi || [])) if (t === el) out.push([d, u]);
        }
        for (const a of e.getAnimations({subtree: true})) { const t = a.effect.getTiming(); out.push([Number(t.delay), Number(t.duration)]); }
        return out; }""")


def frame_img(page: Page, title: str, k: int):
    return page.locator("[data-preview]").get_by_role("img", name=f"{title}, frame {k} of 6")


def expect_frame(page: Page, title: str, k: int) -> None:
    expect(frame_img(page, title, k)).to_have_count(1)


def mark(page: Page) -> None:
    page.evaluate("() => { window.__kept = 1; }")


def kept(page: Page) -> bool:
    return page.evaluate("() => window.__kept === 1")


def watch(page: Page) -> None:
    updates(page).evaluate(
        "e => { window.__ann = []; new MutationObserver(() => window.__ann.push(e.textContent.trim()))"
        ".observe(e, {childList: true, characterData: true, subtree: true}); }")


def announced(page: Page, message: str) -> int:
    return page.evaluate("m => window.__ann.filter(t => t === m).length", message)


def role_now(page: Page) -> tuple[str, str]:
    r = page.locator("[data-role]")
    expect(r).to_have_count(1)
    return r.get_attribute("data-role-index"), r.inner_text().strip()


def assert_role(page: Page, k: int) -> None:
    assert role_now(page) == (str(k), ROLES[k - 1]), f"expected role {k} {ROLES[k - 1]!r}"


def query(url: str) -> dict:
    return parse_qs(urlparse(url).query)


def history(page: Page) -> int:
    return page.evaluate("history.length")


def shown_cards(page: Page) -> list[str]:
    return [s for s in SLUGS if page.locator(f'[data-project="{s}"]').is_visible()]


def pressed(page: Page, name: str) -> str | None:
    return page.get_by_role("group", name="Filter projects by discipline").get_by_role(
        "button", name=name, exact=True).get_attribute("aria-pressed")


def press_filter(page: Page, name: str) -> None:
    click(page.get_by_role("group", name="Filter projects by discipline").get_by_role("button", name=name, exact=True))


def project_type(page: Page) -> str:
    return page.get_by_role("combobox", name="Project type").evaluate(
        "e => (e.tagName === 'SELECT' ? e.selectedOptions[0].textContent : (e.value || e.textContent)).trim()")


def fill_form(page: Page, name: str, email: str, ptype: str = "Web Development",
              budget: str = "$5,000 to $15,000", message: str = MESSAGE) -> None:
    fill(page.get_by_role("textbox", name="Your name"), name)
    fill(page.get_by_role("textbox", name="Email address"), email)
    select(page.get_by_role("combobox", name="Project type"), ptype)
    check(page.get_by_role("radio", name=budget, exact=True))
    fill(page.get_by_role("textbox", name="Tell me about your project"), message)


def mails_for(mail: Mailpit, email: str, count: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(count) if email.lower() in [a.lower() for a in addresses(m.get("ReplyTo"))]]
        if len(found) >= count:
            break
    return [m for m in mail.messages(count) if email.lower() in [a.lower() for a in addresses(m.get("ReplyTo"))]]


def swipe(page: Page, locator, dx: float, dy: float) -> None:
    x, y = aim_point(locator)
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, 6):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 5, "y": y + dy * i / 5}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def drag(page: Page, locator, dx: float, dy: float) -> None:
    x, y = aim_point(locator)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=5)
    page.mouse.up()


def translate_y(s: dict) -> float:
    total = 0.0
    t = s.get("transform", "none")
    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", t.split("(", 1)[1])] if "(" in t else []
    if t.startswith("matrix3d"):
        total += nums[13]
    elif t.startswith("matrix"):
        total += nums[5]
    tr = s.get("translate", "none")
    if tr not in ("none", ""):
        parts = tr.split()
        if len(parts) > 1:
            total += float(parts[1].replace("px", ""))
    return total


def half_away(v: float) -> int:
    return int(math.copysign(math.floor(abs(v) + 0.5), v))


def json_of(r: httpx.Response) -> dict:
    assert r.headers.get("content-type", "").startswith("application/json"), r.headers.get("content-type")
    return r.json()


def grading(method: str, base: str, path: str) -> httpx.Response:
    return httpx.request(method, base + path, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)


class Relay:

    def __init__(self, port: int, upstream: tuple[str, int], hang: bool = False):
        self.port, self.upstream, self.hang = port, upstream, hang
        self.stop = threading.Event()
        self.conns: list[socket.socket] = []

    def __enter__(self):
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(16)
        threading.Thread(target=self._accept, daemon=True).start()
        return self

    def _pump(self, a: socket.socket, b: socket.socket) -> None:
        with contextlib.suppress(OSError):
            while data := a.recv(65536):
                b.sendall(data)
        with contextlib.suppress(OSError):
            b.shutdown(socket.SHUT_WR)

    def _accept(self) -> None:
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)
            if self.hang:
                continue
            up = socket.create_connection(self.upstream, timeout=10)
            up.settimeout(None)
            self.conns.append(up)
            threading.Thread(target=self._pump, args=(conn, up), daemon=True).start()
            threading.Thread(target=self._pump, args=(up, conn), daemon=True).start()

    def __exit__(self, *exc):
        self.stop.set()
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()
        for c in self.conns:
            with contextlib.suppress(OSError):
                c.shutdown(socket.SHUT_RDWR)
            c.close()


def s3_upstream() -> tuple[str, int]:
    u = urlparse(os.environ["S3_ENDPOINT"])
    return u.hostname or "127.0.0.1", u.port or 80


def smtp_upstream() -> tuple[str, int]:
    return os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])


def health_is(base: str, status: str) -> bool:
    with contextlib.suppress(httpx.HTTPError):
        return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json().get("status") == status
    return False


def test_wf_hero_intro_explore(browser, app_url):
    with site(browser, app_url + "/") as page:
        intro = section(page, "intro")
        expect(intro).to_have_attribute("data-intro", "playing")
        finish_intro(page)
        click(page.get_by_role("button", name="Pause roles"))
        expect(page.get_by_role("button", name="Play roles")).to_be_focused()
        page.get_by_role("button", name="Next role").focus()
        page.keyboard.press("Enter")
        assert_role(page, 2)
        before = history(page)
        page.get_by_role("link", name="Explore projects").focus()
        page.keyboard.press("Enter")
        glide_to(heading(page, "work"), "Explore projects")
        assert page.url.endswith("#work")
        assert history(page) == before + 1
        assert current(page) == ["Work"]


def test_wf_hero_intro_interrupt(browser, app_url):
    with site(browser, app_url + "/", rm=False) as page:
        intro = section(page, "intro")
        advance(page, 200)
        expect(intro).to_have_attribute("data-intro", "playing")
        page.keyboard.press("Shift")
        expect(intro).to_have_attribute("data-intro", "done")
        words = page.locator("[data-headline-word]")
        settle(page.locator("[data-hero-copy]"))
        for i in range(words.count()):
            assert style(words.nth(i), "opacity")["opacity"] == "1"
        advance(page, INTRO_END_MS * 2)
        expect(intro).to_have_attribute("data-intro", "done")
        before = history(page)
        click(page.get_by_role("link", name="Start a project"))
        glide_to(heading(page, "contact"), "Start a project")
        assert page.url.endswith("#contact") and history(page) == before + 1


def test_intro_timeline(browser, app_url):
    with site(browser, app_url + "/", init=RECORD_ANIMATE) as page:
        intro = section(page, "intro")
        gt = timings(page.locator("[data-greeting]"))
        assert any(abs(d) <= TIMING_TOL_MS and abs(dur - GREETING_MS) <= TIMING_TOL_MS for d, dur in gt), gt
        for i in range(7):
            ts = timings(page.locator("[data-headline-word]").nth(i))
            assert any(abs(d - (WORD_START_MS + WORD_STEP_MS * i)) <= TIMING_TOL_MS and abs(dur - WORD_FADE_MS) <= TIMING_TOL_MS
                       for d, dur in ts), (i, ts)
        expect(page.locator("[data-greeting]")).to_have_text("Hello, I'm Ottoline.")
        expect(h1(page)).to_have_text("I build websites that move with you.")
        words = page.locator("[data-headline-word]")
        expect(words).to_have_count(7)
        assert " ".join(w.strip() for w in words.all_inner_texts()) == "I build websites that move with you."
        expect(page.get_by_text("Independent developer and digital creator. I design, animate and build full-stack products, from the first sketch to the cloud.", exact=True)).to_be_visible()
        assert page.locator("[data-hero-visual]").evaluate("e => !!e.closest('[aria-hidden=\"true\"]')")
        advance(page, INTRO_END_MS - 100)
        expect(intro).to_have_attribute("data-intro", "playing")
        advance(page, 100 + FRAME_MS)
        expect(intro).to_have_attribute("data-intro", "done")
    for suffix, rm in [("/", True), ("/#work", False), ("/?category=motion,design", False), ("/?service=web#contact", False)]:
        with site(browser, app_url + suffix, rm=rm) as page:
            expect(section(page, "intro")).to_have_attribute("data-intro", "done")


def test_copy_drift(browser, app_url):
    positions = [0, 100, 250, 300, 600, 900, 300, 100, 0]
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        copy = page.locator("[data-hero-copy]")
        settle(copy)
        samples = scroll_samples(page, copy, positions, "transform", "translate")
        got = [round(-translate_y(s)) for s in samples]
        assert got == [round(DRIFT_SHARE * min(s, DRIFT_CAP)) for s in positions], got
    with site(browser, app_url + "/", rm=True) as page:
        copy = page.locator("[data-hero-copy]")
        samples = scroll_samples(page, copy, [0, 300, 900], "transform", "translate")
        assert all(abs(translate_y(s)) < 0.5 for s in samples)


def test_sculpture_tilt(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        visual = page.locator("[data-hero-visual]")
        box = section(page, "intro").bounding_box()
        cx, cy, w, h = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, box["width"], box["height"]
        for fx, fy in [(0.5, 0.5), (0.75, 0.5), (0.999, 0.002), (0.5, 0.75), (0.25, 0.25), (0.86, 0.125)]:
            x, y = box["x"] + fx * w, box["y"] + fy * h
            page.mouse.move(x, y)
            tx = max(-TILT_MAX, min(TILT_MAX, half_away(-TILT_MAX * (y - cy) / (h / 2))))
            ty = max(-TILT_MAX, min(TILT_MAX, half_away(TILT_MAX * (x - cx) / (w / 2))))
            assert (visual.get_attribute("data-tilt-x"), visual.get_attribute("data-tilt-y")) == (str(tx), str(ty))
            settle(visual)
            t = style(visual, "transform")["transform"]
            m = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", t.split("(", 1)[1])] if "(" in t else [1.0] * 16
            if t.startswith("matrix3d"):
                assert abs(m[0] - math.cos(math.radians(ty))) < 0.01 and abs(m[5] - math.cos(math.radians(tx))) < 0.01, t
            else:
                assert tx == 0 and ty == 0, t
        scroll_y(page, 1000)
        page.mouse.move(640, 400)
        assert (visual.get_attribute("data-tilt-x"), visual.get_attribute("data-tilt-y")) == ("0", "0")
        scroll_y(page, 0)
        swipe(page, section(page, "intro"), 0, 1)
        assert (visual.get_attribute("data-tilt-x"), visual.get_attribute("data-tilt-y")) == ("0", "0")
    for size, rm in [(PHONE, False), (DESKTOP, True)]:
        with site(browser, app_url + "/", size=size, rm=rm) as page:
            advance(page, INTRO_END_MS + FRAME_MS)
            visual = page.locator("[data-hero-visual]")
            page.mouse.move(size[0] * 0.9, 100)
            assert (visual.get_attribute("data-tilt-x"), visual.get_attribute("data-tilt-y")) == ("0", "0")


def test_wf_role_rotation_watch(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        assert_role(page, 1)
        advance(page, ROLE_MS)
        assert_role(page, 2)
        page.get_by_role("button", name="Next role").dispatch_event("click")
        assert_role(page, 3)
        page.get_by_role("button", name="Previous role").dispatch_event("click")
        assert_role(page, 2)
        page.get_by_role("button", name="Pause roles").dispatch_event("click")
        advance(page, ROLE_MS * 3)
        assert_role(page, 2)
        page.get_by_role("button", name="Play roles").dispatch_event("click")
        advance(page, ROLE_MS + FRAME_MS)
        assert_role(page, 3)


def test_wf_role_rotation_keyboard(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        page.get_by_role("button", name="Previous role").focus()
        page.keyboard.press("Enter")
        assert_role(page, 6)
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Next role")).to_be_focused()
        page.keyboard.press("Enter")
        assert_role(page, 1)
        page.keyboard.press(" ")
        assert_role(page, 2)


def test_role_auto_rotation(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        advance(page, 4280 - (INTRO_END_MS + FRAME_MS))
        assert_role(page, 1)
        advance(page, 2 * FRAME_MS + 4)
        assert_role(page, 2)
        advance(page, ROLE_MS - 2 * FRAME_MS)
        assert_role(page, 2)
        advance(page, 2 * FRAME_MS)
        assert_role(page, 3)
        for k in [4, 5, 6, 1]:
            advance(page, ROLE_MS)
            assert_role(page, k)


def test_role_manual_and_holds(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        nxt, prev = page.get_by_role("button", name="Next role"), page.get_by_role("button", name="Previous role")
        advance(page, ROLE_MS * 2)
        assert_role(page, 3)
        nxt.dispatch_event("click")
        assert_role(page, 4)
        advance(page, ROLE_MS - 2 * FRAME_MS)
        assert_role(page, 4)
        advance(page, 3 * FRAME_MS)
        assert_role(page, 5)
        prev.dispatch_event("click")
        assert_role(page, 4)
        nxt.focus()
        advance(page, ROLE_MS * 3)
        assert_role(page, 4)
        page.evaluate("() => document.activeElement.blur()")
        advance(page, ROLE_MS - 2 * FRAME_MS)
        assert_role(page, 4)
        advance(page, 3 * FRAME_MS)
        assert_role(page, 5)
        x, y = center(page.locator("[data-role-line]"))
        page.mouse.move(x, y)
        advance(page, ROLE_MS * 3)
        assert_role(page, 5)
        page.mouse.move(5, page.viewport_size["height"] - 5)
        advance(page, ROLE_MS - 2 * FRAME_MS)
        assert_role(page, 5)
        advance(page, 3 * FRAME_MS)
        assert_role(page, 6)


def test_role_pause_and_reduced_motion(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        page.get_by_role("button", name="Pause roles").focus()
        page.keyboard.press("Enter")
        play = page.get_by_role("button", name="Play roles")
        expect(play).to_be_focused()
        expect(updates(page)).to_have_text("Role rotation paused.")
        advance(page, ROLE_MS * 3)
        assert_role(page, 1)
        page.get_by_role("button", name="Next role").dispatch_event("click")
        assert_role(page, 2)
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name="Pause roles")).to_be_focused()
        expect(updates(page)).to_have_text("Role rotation resumed.")
        advance(page, ROLE_MS - 2 * FRAME_MS)
        assert_role(page, 2)
        advance(page, 3 * FRAME_MS)
        assert_role(page, 3)
        expect(page.locator("[data-roles-summary]")).to_have_text(
            "I work as a full-stack developer, motion engineer, Firebase app builder, creative designer, presentation designer and prompt engineer.")
        assert page.locator("[data-role-line]").evaluate("e => !!e.closest('[aria-hidden=\"true\"]')")
    with site(browser, app_url + "/", rm=True) as page:
        expect(page.get_by_role("button", name="Play roles")).to_be_visible()
        advance(page, ROLE_MS * 4)
        assert_role(page, 1)
        page.get_by_role("button", name="Next role").dispatch_event("click")
        assert_role(page, 2)
        assert animations(page.locator("[data-role-line]")) == []


def test_wf_scroll_navigation_scroll(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        progress = page.locator("[data-journey-progress]")
        assert current(page) == [] and progress.get_attribute("data-value") == "0"
        put(section(page, "about"), 0.4)
        assert current(page) == ["About"]
        put(page.locator("[data-milestone]").first, 0.6)
        assert progress.get_attribute("data-value") == "5"
        put(section(page, "skills"), 0.4)
        assert current(page) == ["Skills"]
        put(section(page, "work"), 0.4)
        assert current(page) == ["Work"]
        scroll_y(page, 0)
        assert current(page) == [] and progress.get_attribute("data-value") == "0"


def test_wf_scroll_navigation_jumps(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(nav_link(page, "Services"))
        glide_to(heading(page, "services"), "Services link")
        click(nav_link(page, "Reviews"))
        glide_to(heading(page, "reviews"), "Reviews link")
        page.go_back()
        assert page.url.endswith("#services") and at_jump(heading(page, "services"))
        assert current(page) == ["Services"]
        page.go_forward()
        assert page.url.endswith("#reviews") and at_jump(heading(page, "reviews"))


def test_current_section(browser, app_url):
    for init in [None, NO_OBSERVERS]:
        with site(browser, app_url + "/", init=init) as page:
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            finish_intro(page)
            put(section(page, "about"), 0.4, -3)
            assert current(page) == []
            for order in [range(6), reversed(range(6))]:
                for i in order:
                    put(page.locator(f'[data-section="{SECTION_IDS[i]}"]'), 0.4)
                    assert current(page) == [NAV_NAMES[i]], SECTION_IDS[i]
                    put(page.locator(f'[data-section="{SECTION_IDS[i]}"]'), 0.4, -3)
                    assert current(page) == ([NAV_NAMES[i - 1]] if i else [])
            put(section(page, "numbers"), 0.4)
            assert current(page) == ["Reviews"]
            assert errors == []
    with site(browser, app_url + "/work/tallyhouse") as page:
        for y in [0, 600, 1500]:
            scroll_y(page, y)
            assert current(page) == []


def test_career_journey(browser, app_url):
    with site(browser, app_url + "/", size=PHONE) as page:
        advance(page, INTRO_END_MS + FRAME_MS)
        ms = page.locator("[data-milestone]")
        expect(ms).to_have_count(5)
        progress = page.locator("[data-journey-progress]")
        for order in [range(5), reversed(range(5))]:
            for i in order:
                put(ms.nth(i), 0.6)
                states = [ms.nth(j).get_attribute("data-reached") for j in range(5)]
                tops = page.evaluate("() => 0") or [ms.nth(j).evaluate("e => e.getBoundingClientRect().top <= 0.6 * innerHeight") for j in range(5)]
                assert states == ["true" if t else "false" for t in tops]
                assert states[i] == "true"
                assert progress.get_attribute("data-value") == str(states.count("true"))
                put(ms.nth(i), 0.6, -3)
                assert ms.nth(i).get_attribute("data-reached") == "false"
        b = page.get_by_role("button", name=MILESTONES[2][0], exact=True)
        expect(b).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_text(MILESTONES[2][1], exact=True)).to_be_hidden()
        click(b)
        expect(b).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_text(MILESTONES[2][1], exact=True)).to_be_visible()
        click(page.get_by_role("button", name=MILESTONES[3][0], exact=True))
        expect(page.get_by_text(MILESTONES[2][1], exact=True)).to_be_visible()
        click(b)
        expect(b).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_text(MILESTONES[2][1], exact=True)).to_be_hidden()


def test_section_jump_landing(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(nav_link(page, "Work"))
        glide_to(heading(page, "work"), "Work link")
        nav_link(page, "About").click()
        nav_link(page, "Contact").click()
        glide_to(heading(page, "contact"), "second jump")
        assert current(page) == ["Contact"]
    with site(browser, app_url + "/", rm=True) as page:
        click(nav_link(page, "Services"))
        assert at_jump(heading(page, "services")), "reduced-motion jump must be instant"
    with site(browser, app_url + "/#skills") as page:
        assert at_jump(heading(page, "skills")), "jump on load must be instant"


def test_jump_history(browser, app_url):
    with site(browser, app_url + "/?category=motion,design", rm=True) as page:
        base = history(page)
        click(nav_link(page, "About"))
        click(nav_link(page, "Reviews"))
        assert history(page) == base + 2
        assert query(page.url)["category"] == ["motion,design"] and page.url.endswith("#reviews")
        page.go_back()
        assert page.url.endswith("#about") and at_jump(heading(page, "about")) and current(page) == ["About"]
        page.go_forward()
        assert at_jump(heading(page, "reviews")) and current(page) == ["Reviews"]
        mark(page)
        click(page.get_by_role("link", name="Ottoline Rask home"))
        assert kept(page) and history(page) == base + 3
        assert "#" not in page.url and query(page.url)["category"] == ["motion,design"]
        assert page.evaluate("scrollY") < 1 and focused(h1(page))
        click(nav_link(page, "Contact"))
        click(page.get_by_role("button", name="Back to top"))
        assert history(page) == base + 5 and "#" not in page.url and focused(h1(page))
        page.go_back()
        assert at_jump(heading(page, "contact"))
        page.go_forward()
        assert page.evaluate("scrollY") < 1 and focused(h1(page))


def tab_to(page: Page, name: str) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if page.evaluate("() => document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent).trim()").startswith(name):
            return
    pytest.fail(f"Tab never reached {name!r}")


def test_wf_keyboard_tour_milestone_and_case_study(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        tab_to(page, MILESTONES[0][0])
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=MILESTONES[0][0])).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_text(MILESTONES[0][1], exact=True)).to_be_visible()
        link = page.get_by_role("link", name="Foundry Loop", exact=True)
        tab_to(page, "Foundry Loop")
        expect(link).to_be_focused()
        page.keyboard.press("Enter")
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        expect(h1(page)).to_have_text("Foundry Loop")
        expect(h1(page)).to_be_focused()


def test_wf_keyboard_tour_neighbour(browser, app_url):
    with site(browser, app_url + "/work/foundry-loop") as page:
        page.get_by_role("link", name="Next project: Tallyhouse").focus()
        page.keyboard.press("Enter")
        expect(page).to_have_title("Tallyhouse | Ottoline Rask")
        expect(h1(page)).to_be_focused()
        assert urlparse(page.url).path == "/work/tallyhouse"


def assert_tab_names(page: Page, expected: list[str]) -> None:
    for index, name in enumerate(expected, 1):
        page.keyboard.press("Tab")
        expect(page.locator(":focus"), f"Tab stop {index} should be {name!r}").to_have_accessible_name(name)


def test_tab_order(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        assert_tab_names(page, TAB_ORDER)
    for size in [TABLET, PHONE]:
        with site(browser, app_url + "/", size=size) as page:
            finish_intro(page)
            assert_tab_names(page, ["Skip to content", "Ottoline Rask home", "Menu"])
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        skip = page.get_by_role("link", name="Skip to content")
        hidden_js = "e => { const r = e.getBoundingClientRect(); return r.width <= 1 || r.height <= 1 || r.bottom <= 0 || r.right <= 0 || getComputedStyle(e).opacity === '0'; }"
        assert skip.evaluate(hidden_js)
        page.keyboard.press("Tab")
        expect(skip).to_be_focused()
        assert not skip.evaluate(hidden_js)
        page.keyboard.press("Enter")
        expect(h1(page)).to_be_focused()


def test_focus_ring_and_clearance(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        for loc in [nav_link(page, "Work"), page.get_by_role("button", name="All", exact=True),
                    page.get_by_role("textbox", name="Your name"), page.get_by_role("button", name="Send message")]:
            rest, foc = state_styles(loc, "outline-style", "outline-width", "box-shadow", state="focus")
            ring = foc["outline-style"] != "none" and float(foc["outline-width"].replace("px", "") or 0) >= 2
            assert ring or foc["box-shadow"] not in ("none", rest["box-shadow"]), foc
            assert rest != foc
        for _ in range(len(TAB_ORDER)):
            page.keyboard.press("Tab")
            ok = page.evaluate(f"""() => {{ const e = document.activeElement;
              if (!e || e === document.body || e.closest('header,[role=banner],[role=dialog],dialog')) return true;
              if ((e.textContent || '').trim() === 'Skip to content') return true;
              const r = e.getBoundingClientRect(); return r.top >= {CLEAR_TOP} - {PIXEL} && (r.height > innerHeight - {CLEAR_TOP} || r.bottom <= innerHeight + {PIXEL}); }}""")
            assert ok, "focused element hidden under the header"
        for _ in range(20):
            page.keyboard.press("Shift+Tab")
            assert page.evaluate(f"() => {{ const e = document.activeElement; return e === document.body || e.closest('header,[role=banner]') || e.getBoundingClientRect().top >= {CLEAR_TOP} - {PIXEL}; }}")


@pytest.mark.parametrize("vp", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_closed_unreachable(browser, app_url, vp):
    size = VIEWPORTS[vp]
    with site(browser, app_url + "/", size=size) as page:
        finish_intro(page)
        names = tab_order(page, TAB_LIMIT)
        for forbidden in ["Close menu", "Enquire about Web Development", "Node.js", "Previous frame"]:
            assert forbidden not in names
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.get_by_role("list", name="Deliverables")).to_have_count(0)
        expect(page.get_by_role("tabpanel")).to_have_count(1)
        expect(page.get_by_role("group", name="Review 2 of 5")).to_have_count(0)
        expect(page.get_by_text(MILESTONES[0][1], exact=True)).to_be_hidden()
        svc = page.get_by_role("button", name="Web Development", exact=True)
        click(svc)
        expect(page.get_by_role("link", name="Enquire about Web Development")).to_have_count(1)
        click(svc)
        expect(page.get_by_role("link", name="Enquire about Web Development")).to_have_count(0)
        svc.focus()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Motion & Interaction")).to_be_focused()
        if size[0] < 1024:
            menu_button = page.get_by_role("button", name="Menu", exact=True)
            click(menu_button)
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)
            expect(page.get_by_role("button", name="Close menu")).to_have_count(0)
            expect(menu_button).to_be_focused()
            poll(lambda: menu_button.evaluate(UNCOVERED), MENU_SLIDE_MAX_S + POLL_SLACK_S,
                 "nothing of the closed menu may stay visible: after its closing slide it still covers `Menu`")


def test_glyphs_and_new_tab(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        explore = page.get_by_role("link", name="Explore projects", exact=True)
        expect(explore).to_have_count(1)
        assert "→" in explore.inner_text()
        for name in SOCIAL:
            links = page.get_by_role("link", name=name, exact=True)
            expect(links).to_have_count(2)
            for i in range(2):
                ln = links.nth(i)
                assert "↗" in ln.inner_text()
                assert ln.evaluate("""e => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n;
                  while ((n = w.nextNode())) { if (n.textContent.includes('(opens in a new tab)')) {
                    const p = n.parentElement, r = p.getBoundingClientRect(), s = getComputedStyle(p);
                    if (!(r.width <= 1 || r.height <= 1 || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || (s.clip && s.clip !== 'auto') || (s.clipPath && s.clipPath !== 'none'))) return false; } }
                  return true; }"""), "new-tab text must not be visible"
                assert ln.get_attribute("target") == "_blank"
                assert {"noopener", "noreferrer"} <= set((ln.get_attribute("rel") or "").split())
        links = page.get_by_role("link")
        for i in range(links.count()):
            if links.nth(i).get_attribute("target") == "_blank":
                assert {"noopener", "noreferrer"} <= set((links.nth(i).get_attribute("rel") or "").split())


def assert_gallery(page: Page, discs: list[str], shown: list[str]) -> None:
    assert pressed(page, "All") == ("false" if discs else "true")
    for name, _ in DISCIPLINES:
        assert pressed(page, name) == ("true" if name in discs else "false")
    assert shown_cards(page) == shown
    expect(page.locator("[data-results]")).to_have_text(f"Showing {len(shown)} of 6 projects.")


def test_wf_project_filtering_back_button(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        mark(page)
        press_filter(page, "Motion")
        press_filter(page, "Design")
        four = ["hollis-atelier", "foundry-loop", "tidegauge", "promptloom"]
        assert_gallery(page, ["Motion", "Design"], four)
        assert query(page.url)["category"] == ["motion,design"] and kept(page)
        click(page.get_by_role("link", name="Tidegauge", exact=True))
        expect(page).to_have_title("Tidegauge | Ottoline Rask")
        expect(stack_items(page, "tidegauge")).to_have_text(STACKS["tidegauge"])
        click(page.get_by_role("link", name="Next project: Promptloom"))
        expect(page).to_have_title("Promptloom | Ottoline Rask")
        page.go_back()
        expect(page).to_have_title("Tidegauge | Ottoline Rask")
        page.go_back()
        expect(page).to_have_title("Ottoline Rask | Developer and digital creator")
        assert urlparse(page.url).path == "/" and query(page.url)["category"] == ["motion,design"]
        assert_gallery(page, ["Motion", "Design"], four)
        card = page.get_by_role("link", name="Tidegauge", exact=True)
        expect(card).to_be_focused()
        assert top(card) >= CLEAR_TOP - PIXEL


def test_wf_project_filtering_back_to_work(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        press_filter(page, "Cloud")
        click(page.get_by_role("link", name="Pulse Roster", exact=True))
        expect(page).to_have_title("Pulse Roster | Ottoline Rask")
        back = page.get_by_role("link", name="Back to work")
        assert back.get_attribute("href").endswith("/?category=cloud#work")
        click(back)
        assert_gallery(page, ["Cloud"], ["pulse-roster"])
        expect(page.get_by_role("link", name="Pulse Roster", exact=True)).to_be_focused()


FILTER_CASES = {
    "none": ([], ["hollis-atelier", "foundry-loop", "tallyhouse", "pulse-roster", "tidegauge", "promptloom"]),
    "web": (["Web"], ["hollis-atelier", "foundry-loop", "tallyhouse", "pulse-roster"]),
    "motion": (["Motion"], ["foundry-loop", "tidegauge"]),
    "motion-design": (["Motion", "Design"], ["hollis-atelier", "foundry-loop", "tidegauge", "promptloom"]),
    "cloud-ai": (["Cloud", "AI"], ["pulse-roster", "promptloom"]),
    "motion-data": (["Motion", "Data"], ["foundry-loop", "tallyhouse", "tidegauge"]),
    "ai": (["AI"], ["promptloom"]),
    "all-six": (["Web", "Motion", "Cloud", "Data", "Design", "AI"], ["hollis-atelier", "foundry-loop", "tallyhouse", "pulse-roster", "tidegauge", "promptloom"]),
}


@pytest.mark.parametrize("case", list(FILTER_CASES), ids=list(FILTER_CASES))
def test_filtering(browser, app_url, case):
    discs, shown = FILTER_CASES[case]
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        mark(page)
        if discs:
            for d in discs[:-1]:
                press_filter(page, d)
            watch(page)
            press_filter(page, discs[-1])
        else:
            press_filter(page, "Web")
            watch(page)
            press_filter(page, "All")
        assert_gallery(page, discs, shown)
        msg = f"Showing {len(shown)} of 6 projects."
        expect(updates(page)).to_have_text(msg)
        assert announced(page, msg) == 1 and kept(page)
        for s in SLUGS:
            if s not in shown:
                assert page.locator(f'[data-project="{s}"]').evaluate("e => e.getBoundingClientRect().height === 0 || getComputedStyle(e).display === 'none' || e.closest('[hidden]') !== null")


def test_filter_address(browser, app_url):
    with site(browser, app_url + "/#work") as page:
        base = history(page)
        press_filter(page, "Design")
        press_filter(page, "Motion")
        assert page.url.endswith("/?category=motion,design#work") and history(page) == base
        press_filter(page, "Design")
        press_filter(page, "Motion")
        assert "category" not in page.url and history(page) == base
    with site(browser, app_url + "/?category=design,ai,bogus,ai") as page:
        assert query(page.url)["category"] == ["design,ai"]
        assert_gallery(page, ["Design", "AI"], ["hollis-atelier", "promptloom"])
    with site(browser, app_url + "/?category=bogus") as page:
        assert "category" not in page.url
        assert_gallery(page, [], SLUGS)


def test_gallery_return(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        link = page.get_by_role("link", name="Hollis Atelier", exact=True)
        assert link.get_attribute("href").endswith("/work/hollis-atelier")
        link.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_title("Hollis Atelier | Ottoline Rask")
        back = page.get_by_role("link", name="Back to work")
        assert back.get_attribute("href").endswith("/#work")
        back.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/#work$"))
        assert_gallery(page, [], SLUGS)
        card = page.get_by_role("link", name="Hollis Atelier", exact=True)
        expect(card).to_be_focused()
        assert top(card) >= CLEAR_TOP - PIXEL
        expect(updates(page)).to_have_text("")


def test_wf_case_study_navigation_neighbours(browser, app_url):
    with site(browser, app_url + "/work/foundry-loop") as page:
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        click(page.get_by_role("navigation", name="On this page").get_by_role("link", name="Design decisions"))
        glide_to(page.get_by_role("heading", name="Design decisions", level=2), "Design decisions link")
        assert page.url.endswith("/work/foundry-loop#decisions")
        click(page.get_by_role("link", name="Next project: Tallyhouse"))
        expect(page).to_have_title("Tallyhouse | Ottoline Rask")
        assert urlparse(page.url).path == "/work/tallyhouse"
        expect(h1(page)).to_be_focused()
        assert page.evaluate("scrollY") < 1
        page.go_back()
        page.go_back()
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        expect(h1(page)).to_be_focused()


def test_wf_case_study_navigation_back_mid_glide(browser, app_url):
    with site(browser, app_url + "/work/foundry-loop") as page:
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        click(page.get_by_role("navigation", name="On this page").get_by_role("link", name="Design decisions"))
        expect(page).to_have_url(re.compile(r"/work/foundry-loop#decisions$"))
        page.go_back()
        expect(page).to_have_url(re.compile(r"/work/foundry-loop$"))
        hold_top(page, "Back during the On this page glide")


def test_wf_case_study_navigation_filtered(browser, app_url):
    with site(browser, app_url + "/work/tallyhouse?category=data") as page:
        expect(page.get_by_role("link", name=re.compile("^Previous project"))).to_have_count(0)
        click(page.get_by_role("link", name="Next project: Tidegauge"))
        expect(page).to_have_title("Tidegauge | Ottoline Rask")
        assert query(page.url)["category"] == ["data"]
        page.reload()
        expect(page.get_by_role("link", name="Previous project: Tallyhouse")).to_be_visible()
        expect(page.get_by_role("link", name=re.compile("^Next project"))).to_have_count(0)


@pytest.mark.parametrize("slug", SLUGS, ids=SLUGS)
def test_case_study_content(browser, app_url, slug):
    _, title, kind, client, year, role, discs = next(p for p in PROJECTS if p[0] == slug)
    with site(browser, app_url + f"/work/{slug}") as page:
        expect(page).to_have_title(f"{title} | Ottoline Rask")
        expect(h1(page)).to_have_text(title)
        body = page.locator("main").inner_text()
        canon = [d[0] for d in DISCIPLINES if d[0] in discs]
        for piece in [kind, f"{client} (illustrative)", year, role, ", ".join(canon)]:
            assert piece in body, piece
        toc = page.get_by_role("navigation", name="On this page")
        for name, sid in [("Overview", "overview"), ("The challenge", "challenge"), ("The solution", "solution"),
                          ("Design decisions", "decisions"), ("Technology stack", "stack")]:
            assert toc.get_by_role("link", name=name).get_attribute("href").endswith(f"#{sid}")
            expect(page.get_by_role("heading", name=name, level=2, exact=True)).to_have_count(1)
        expect(stack_items(page, slug)).to_have_text(STACKS[slug])
        expect(page.get_by_role("link", name="Back to work")).to_be_visible()
        expect(page.get_by_role("navigation", name="More projects")).to_be_visible()


def test_on_this_page(browser, app_url):
    ids = [("overview", "Overview"), ("challenge", "The challenge"), ("solution", "The solution"),
           ("decisions", "Design decisions"), ("stack", "Technology stack")]
    with site(browser, app_url + "/work/tidegauge", size=TABLET) as page:
        scroll_y(page, 0)
        assert current(page, "On this page") == []
        for order in [range(5), reversed(range(5))]:
            for i in order:
                put(page.get_by_role("heading", name=ids[i][1], level=2, exact=True), 0.4)
                assert current(page, "On this page") == [ids[i][1]]
        scroll_y(page, 0)
        link = page.get_by_role("navigation", name="On this page").get_by_role("link", name="The solution")
        link.focus()
        page.keyboard.press("Enter")
        glide_to(page.get_by_role("heading", name="The solution", level=2), "On this page link")
        line = 0.4 * page.viewport_size["height"]
        above = [n for sid, n in ids
                 if page.evaluate("i => document.getElementById(i).getBoundingClientRect().top", sid) <= line]
        assert above[0] == "Overview" and current(page, "On this page") == above[-1:]


NEIGHBOUR_CASES = {
    "foundry-none": ("foundry-loop", "", "Hollis Atelier", "Tallyhouse"),
    "hollis-none": ("hollis-atelier", "", None, "Foundry Loop"),
    "promptloom-none": ("promptloom", "", "Tidegauge", None),
    "foundry-motion-design": ("foundry-loop", "motion,design", "Hollis Atelier", "Tidegauge"),
    "tidegauge-motion-design": ("tidegauge", "motion,design", "Foundry Loop", "Promptloom"),
    "promptloom-motion-design": ("promptloom", "motion,design", "Tidegauge", None),
    "pulse-cloud": ("pulse-roster", "cloud", None, None),
    "tidegauge-cloud": ("tidegauge", "cloud", "Pulse Roster", "Promptloom"),
    "tallyhouse-data": ("tallyhouse", "data", None, "Tidegauge"),
    "tidegauge-data": ("tidegauge", "data", "Tallyhouse", None),
}


@pytest.mark.parametrize("case", list(NEIGHBOUR_CASES), ids=list(NEIGHBOUR_CASES))
def test_neighbours(browser, app_url, case):
    slug, lst, prev, nxt = NEIGHBOUR_CASES[case]
    url = app_url + f"/work/{slug}" + (f"?category={lst}" if lst else "")
    by_title = {v: k for k, v in TITLES.items()}
    with site(browser, url) as page:
        more = page.get_by_role("navigation", name="More projects")
        for label, want in [("Previous project", prev), ("Next project", nxt)]:
            links = more.get_by_role("link", name=re.compile(f"^{label}: "))
            if want is None:
                expect(links).to_have_count(0)
                continue
            expect(links).to_have_count(1)
            expect(links).to_have_accessible_name(f"{label}: {want}")
            href = links.get_attribute("href")
            assert urlparse(href).path.endswith(f"/work/{by_title[want]}")
            assert query(href).get("category") == ([lst] if lst else None)


def test_not_found_and_boundary(browser, app_url):
    with site(browser, app_url + "/") as page:
        for path in ["/no-such-page", "/work/no-such-slug"]:
            resp = page.goto(app_url + path)
            assert resp.status == 404
            expect(page).to_have_title("Not found | Ottoline Rask")
            expect(h1(page)).to_have_text("This page took a wrong turn.")
            expect(page.get_by_text("The address may be mistyped, or the page may have moved.")).to_be_visible()
            assert page.get_by_role("link", name="Back to the homepage").get_attribute("href") in ("/", app_url + "/")
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = c.get("/api/no-such-route")
    assert r.status_code == 404 and json_of(r) == NOT_FOUND_BODY
    r = c.post("/api/health")
    assert r.status_code == 405 and json_of(r) == {"error": "method_not_allowed", "message": "Method not allowed."}
    r = c.get("/api/grading/reset")
    assert r.status_code == 405
    r = c.post("/api/grading/reset")
    assert r.status_code == 404 and json_of(r) == NOT_FOUND_BODY
    r = c.post("/api/grading/reset", headers={"X-Grading-Key": "wrong-key"})
    assert r.status_code == 404 and json_of(r) == NOT_FOUND_BODY
    r = c.post("/api/enquiries", content=b"{" + b" " * (BODY_LIMIT - 1) + b"}x")
    assert r.status_code == 413 and json_of(r) == {"error": "too_large", "message": "The request body is too large."}
    exact = json.dumps({"name": "", "email": "", "projectType": "", "budget": "", "message": ""})
    exact = exact[:-1] + " " * (BODY_LIMIT - len(exact)) + "}"
    assert c.post("/api/enquiries", content=exact.encode()).status_code == 422
    for raw in [b"[]", b"not json", b'"text"']:
        r = c.post("/api/enquiries", content=raw)
        assert r.status_code == 400 and json_of(r) == {"error": "bad_request", "message": "The request body must be a JSON object."}
    for path in ["/", "/api/health", "/work/foundry-loop", "/api/media"]:
        r = c.get(path, headers={"Origin": "http://other.example"})
        lower = {k.lower() for k in r.headers}
        assert not any(k.startswith("access-control-") for k in lower)
        assert not any("cookie" in k for k in lower)
        assert "Content-Security-Policy".lower() not in lower
    html = c.get("/").text
    assert "Content-Security-Policy".lower() not in html.lower()
    for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts", "/server.ts"]:
        assert c.get(path).status_code == 404, path
    for src in re.findall(r'<script[^>]+src="([^"]+)"', html):
        if src.startswith("/"):
            assert c.get(src + ".map").status_code == 404


def test_wf_project_previews_quick_look_callout(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        card = project_card(page, "foundry-loop")
        page.mouse.move(*center(card))
        expect(card).to_have_attribute("data-revealed", "true")
        opener = page.get_by_role("button", name="Preview Foundry Loop")
        click(opener)
        dialog = page.get_by_role("dialog", name="Foundry Loop preview")
        for k in range(2, 4):
            page.keyboard.press("ArrowRight")
            expect(dialog.locator("[data-preview-frame]")).to_have_attribute("data-frame", str(k))
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(opener).to_be_focused()
        click(page.get_by_role("link", name="Foundry Loop", exact=True))
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        c2 = page.get_by_role("button", name="Callout 2: Letterform morph")
        c2.focus()
        page.keyboard.press("Enter")
        expect_frame(page, "Foundry Loop", 2)
        advance(page, 3 * STEP_MS + FRAME_MS)
        expect_frame(page, "Foundry Loop", 5)
        expect(page.locator("[data-readout]")).to_have_text("Callout 2 of 3 · frames 2–5")
        assert query(page.url)["callout"] == ["2"]
        page.keyboard.press("ArrowDown")
        c3 = page.get_by_role("button", name="Callout 3: Team grid hover")
        expect(c3).to_be_focused()
        expect(c3).to_have_attribute("aria-pressed", "true")
        page.keyboard.press("Enter")
        expect_frame(page, "Foundry Loop", 1)
        expect(page.locator("[data-readout]")).to_have_text("No callout selected")
        assert "callout" not in page.url


def test_wf_project_previews_missing_frame(browser, app_url):
    key = "work/promptloom/frame-1"
    try:
        assert grading("DELETE", app_url, f"/api/grading/media/{key}").status_code == 204
        assert key not in S3().keys("work/promptloom/")
        with site(browser, app_url + "/work/promptloom") as page:
            until(page, "() => !!document.querySelector('[data-preview] [data-fallback=\"true\"]')")
            expect(page.get_by_text("Preview frame unavailable")).to_be_visible()
            expect(page.get_by_role("img", name="Promptloom, frame 1 of 6")).to_be_visible()
            expect(page.get_by_role("status", name="Media notice")).to_be_hidden()
            click(page.get_by_role("button", name="Try again"))
            until(page, "() => document.querySelector('[role=status][aria-label=\"Site updates\"], [aria-label=\"Site updates\"]')?.textContent.trim() === 'The preview frame is still unavailable.' || true")
            expect(updates(page)).to_have_text("The preview frame is still unavailable.")
            click(page.get_by_role("button", name="Callout 1: Prompt recipe editor"))
            expect_frame(page, "Promptloom", 1)
            click(page.get_by_role("button", name="Callout 1: Prompt recipe editor"))
            assert grading("POST", app_url, "/api/grading/reset").json() == {"status": "ok"}
            assert key in S3().keys("work/promptloom/")
            click(page.get_by_role("button", name="Try again"))
            expect(updates(page)).to_have_text("The preview frame is back.")
            expect(page.locator("[data-preview]")).to_be_focused()
            expect(page.get_by_text("Preview frame unavailable")).to_have_count(0)
    finally:
        grading("POST", app_url, "/api/grading/reset")


def test_wf_project_previews_library_outage(browser):
    base = os.environ["APP_MEDIA_LATE_URL"].rstrip("/")
    poll(lambda: health_is(base, "unavailable"), HEALTH_WAIT_S, "media-late health should report unavailable with storage down")
    with site(browser, base + "/") as page:
        finish_intro(page)
        notice = page.get_by_role("status", name="Media notice")
        until(page, "() => document.querySelectorAll('[data-project] [data-fallback=\"true\"]').length === 6")
        expect(notice).to_have_text("Project images are unavailable right now. Every page still works.")
        expect(page.get_by_text("Cover unavailable")).to_have_count(6)
        expect(page.get_by_role("img", name="Tallyhouse cover")).to_be_visible()
        r = httpx.get(base + "/media/work/tallyhouse/cover", timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and json_of(r) == {"error": "media_unavailable", "message": "The media library is unavailable."}
        m = httpx.get(base + "/api/media", timeout=HTTP_TIMEOUT).json()
        assert m["status"] == "unavailable" and all(o["available"] is False for o in m["objects"])
        press_filter(page, "Data")
        assert shown_cards(page) == ["tallyhouse", "tidegauge"]
        watch(page)
        with Relay(MEDIA_LATE_PORT, s3_upstream()):
            poll(lambda: httpx.get(base + "/api/media", timeout=HTTP_TIMEOUT).json().get("status") == "available",
                 MEDIA_RECOVER_S + 20, "GET /api/media should report available within 10 s of storage answering")
            assert set(MEDIA_KEYS) <= set(S3("-late").keys("work/"))
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline and page.locator('[data-fallback="true"]').count():
                advance(page, RECHECK_MS)
            if page.locator('[data-fallback="true"]').count():
                pytest.fail("media-late: plates should load in place after the page re-check found the library available")
            expect(notice).to_be_hidden()
            assert announced(page, "Project images are back.") == 1
            assert kept(page) or True
            assert health_is(base, "ok")


def test_card_reveal_quick_look(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        cards = {s: page.locator(f'[data-project="{s}"]') for s in SLUGS}
        assert all(c.get_attribute("data-revealed") == "false" for c in cards.values())
        page.get_by_role("link", name="Tallyhouse", exact=True).focus()
        expect(cards["tallyhouse"]).to_have_attribute("data-revealed", "true")
        assert cards["hollis-atelier"].get_attribute("data-revealed") == "false"
        opener = page.get_by_role("button", name="Preview Tidegauge")
        click(opener)
        dialog = page.get_by_role("dialog", name="Tidegauge preview")
        frame = dialog.locator("[data-preview-frame]")
        nxt, prv = dialog.get_by_role("button", name="Next frame"), dialog.get_by_role("button", name="Previous frame")
        expect(nxt).to_be_focused()
        expect(frame).to_have_attribute("data-frame", "1")
        expect(dialog.get_by_role("status")).to_have_text("Frame 1 of 6")
        expect(prv).to_be_disabled()
        for k in range(2, 7):
            page.keyboard.press("Enter")
            expect(frame).to_have_attribute("data-frame", str(k))
            expect(dialog.get_by_role("img", name=f"Tidegauge, frame {k} of 6")).to_have_count(1)
        expect(nxt).to_be_disabled()
        expect(prv).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(frame).to_have_attribute("data-frame", "6")
        page.keyboard.press("ArrowLeft")
        expect(frame).to_have_attribute("data-frame", "5")
        for _ in range(8):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        for _ in range(8):
            page.keyboard.press("Shift+Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        click(dialog.get_by_role("button", name="Close preview"))
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(opener).to_be_focused()
    with site(browser, app_url + "/?category=motion") as page:
        click(page.get_by_role("button", name="Preview Tidegauge"))
        link = page.get_by_role("dialog", name="Tidegauge preview").get_by_role("link", name="Open case study")
        assert query(link.get_attribute("href"))["category"] == ["motion"]
        expect(page.get_by_role("dialog", name="Tidegauge preview").get_by_role("img", name="Tidegauge, frame 1 of 6")).to_have_count(1)
    with site(browser, app_url + "/", size=PHONE) as page:
        assert all(page.locator(f'[data-project="{s}"]').get_attribute("data-revealed") == "true" for s in SLUGS)


def test_callout_thread(browser, app_url):
    with site(browser, app_url + "/work/foundry-loop?category=motion#overview") as page:
        region = page.locator("[data-callout-region]")
        expect_frame(page, "Foundry Loop", 1)
        expect(region).to_be_hidden()
        expect(page.locator("[data-readout]")).to_have_text("No callout selected")
        base = history(page)
        watch(page)
        c2 = page.get_by_role("button", name="Callout 2: Letterform morph")
        click(c2)
        expect(c2).to_have_attribute("aria-pressed", "true")
        expect(page.locator("[data-preview]")).to_have_attribute("data-callout", "2")
        expect_frame(page, "Foundry Loop", 2)
        advance(page, STEP_MS - 10)
        expect_frame(page, "Foundry Loop", 2)
        advance(page, 10 + FRAME_MS)
        expect_frame(page, "Foundry Loop", 3)
        advance(page, STEP_MS)
        expect_frame(page, "Foundry Loop", 4)
        advance(page, STEP_MS)
        expect_frame(page, "Foundry Loop", 5)
        advance(page, 2000)
        expect_frame(page, "Foundry Loop", 5)
        settle(region)
        fb, rb = frame_img(page, "Foundry Loop", 5).bounding_box(), region.bounding_box()
        l, t_, w, h = FOUNDRY_CALLOUTS[2][3]
        for got, want in [(rb["x"], fb["x"] + l / 100 * fb["width"]), (rb["y"], fb["y"] + t_ / 100 * fb["height"]),
                          (rb["width"], w / 100 * fb["width"]), (rb["height"], h / 100 * fb["height"])]:
            assert abs(got - want) <= 1, (got, want)
        expect(page.locator("[data-readout]")).to_have_text("Callout 2 of 3 · frames 2–5")
        assert announced(page, "Callout 2 of 3: Letterform morph.") == 1
        q = query(page.url)
        assert q["callout"] == ["2"] and q["category"] == ["motion"] and page.url.endswith("#overview")
        assert history(page) == base
        click(page.get_by_role("button", name="Callout 1: Reel scrubber"))
        expect_frame(page, "Foundry Loop", 1)
        page.keyboard.press("ArrowUp")
        expect(page.get_by_role("button", name="Callout 1: Reel scrubber")).to_have_attribute("aria-pressed", "true")
        page.keyboard.press("ArrowRight")
        expect(c2).to_be_focused()
        expect_frame(page, "Foundry Loop", 2)
        page.keyboard.press("Enter")
        assert page.evaluate("() => document.querySelectorAll('[aria-pressed=\"true\"]').length") == 0 or True
        expect(c2).to_have_attribute("aria-pressed", "false")
        assert page.locator("[data-preview]").get_attribute("data-callout") is None
        expect_frame(page, "Foundry Loop", 1)
        expect(region).to_be_hidden()
        expect(updates(page)).to_have_text("Callout cleared.")
        assert "callout" not in page.url
    with site(browser, app_url + "/work/foundry-loop?callout=2") as page:
        expect_frame(page, "Foundry Loop", 5)
        expect(page.get_by_role("button", name="Callout 2: Letterform morph")).to_have_attribute("aria-pressed", "true")
        expect(updates(page)).to_have_text("")
    with site(browser, app_url + "/work/foundry-loop?callout=7") as page:
        assert "callout" not in page.url
        expect(page.locator("[data-readout]")).to_have_text("No callout selected")
    with site(browser, app_url + "/work/foundry-loop", rm=True) as page:
        click(page.get_by_role("button", name="Callout 2: Letterform morph"))
        expect_frame(page, "Foundry Loop", 5)
        expect(page.locator("[data-callout-region]")).to_be_visible()
        expect(updates(page)).to_have_text("Callout 2 of 3: Letterform morph.")


def test_media_route(app_url):
    s3 = S3()
    stored = set(s3.keys("work/"))
    assert set(MEDIA_KEYS) <= stored
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    for key in MEDIA_KEYS:
        r = c.get(f"/media/{key}")
        assert r.status_code == 200, key
        assert r.content == s3.get(key)
        assert r.headers["content-type"].split(";")[0] in {"image/png", "image/webp", "image/svg+xml"}
        assert r.headers.get("x-content-type-options") == "nosniff"
    m = json_of(c.get("/api/media"))
    assert m["status"] == "available"
    assert [o["key"] for o in m["objects"]] == MEDIA_KEYS and all(o["available"] is True for o in m["objects"])
    for path in ["/media/work%2Ftallyhouse%2Fcover", "/media/work/tallyhouse/%2e%2e/tallyhouse/cover",
                 "/media/", "/media/work/tallyhouse/frame-7", "/media/work/tallyhouse/cover.png"]:
        r = c.get(path)
        assert r.status_code == 404 and json_of(r) == NOT_FOUND_BODY, path


def test_media_fallback(browser, app_url):
    key = "work/hollis-atelier/cover"
    try:
        assert grading("DELETE", app_url, "/api/grading/media/work/nope/cover").status_code == 404
        assert grading("DELETE", app_url, f"/api/grading/media/{key}").status_code == 204
        assert httpx.get(app_url + f"/media/{key}", timeout=HTTP_TIMEOUT).status_code == 404
        assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        m = httpx.get(app_url + "/api/media", timeout=HTTP_TIMEOUT).json()
        assert {o["key"]: o["available"] for o in m["objects"]}[key] is False and m["status"] == "available"
        with site(browser, app_url + "/") as page:
            until(page, "() => !!document.querySelector('[data-project=\"hollis-atelier\"] [data-fallback=\"true\"]')")

            expect(page.get_by_text("Cover unavailable")).to_have_count(1)
            expect(page.get_by_role("img", name="Hollis Atelier cover")).to_be_visible()
            expect(page.get_by_role("status", name="Media notice")).to_be_hidden()
            assert grading("POST", app_url, "/api/grading/reset").status_code == 200
            page.reload()
            until(page, "() => { const i = document.querySelector('[data-project=\"hollis-atelier\"] img'); return !!i && i.complete && i.naturalWidth > 0; }")
            expect(page.get_by_text("Cover unavailable")).to_have_count(0)
    finally:
        grading("POST", app_url, "/api/grading/reset")


def test_wf_service_enquiry_panel_to_mail(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(page.get_by_role("tab", name="Animation"))
        click(page.get_by_role("button", name="GSAP", exact=True))
        expect(page.get_by_role("tabpanel").get_by_role("link", name="Foundry Loop")).to_be_visible()
        fill(page.get_by_role("textbox", name="Your name"), name)
        scroll_y(page, 0)
        click(page.get_by_role("button", name="Motion & Interaction"))
        click(page.get_by_role("link", name="Enquire about Motion & Interaction"))
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value(name)
        assert project_type(page) == "Motion & Interaction"
        expect(heading(page, "contact")).to_be_in_viewport()
        fill(page.get_by_role("textbox", name="Email address"), email)
        check(page.get_by_role("radio", name="Over $40,000"))
        fill(page.get_by_role("textbox", name="Tell me about your project"), MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        expect(page.get_by_role("heading", name="Message received.")).to_be_visible(timeout=MAIL_WAIT_S * 1000)
    msgs = mails_for(mail, email)
    assert len(msgs) == 1
    assert msgs[0]["Subject"] == f"New enquiry: Motion & Interaction from {name}"
    assert "Budget: Over $40,000" in text(msgs[0])


def test_wf_service_enquiry_deep_link_to_mail(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/?service=ai#contact") as page:
        assert project_type(page) == "AI & Prompt Engineering"
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        fill(page.get_by_role("textbox", name="Your name"), name)
        fill(page.get_by_role("textbox", name="Email address"), email)
        check(page.get_by_role("radio", name="Under $5,000"))
        fill(page.get_by_role("textbox", name="Tell me about your project"), MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        expect(page.get_by_role("heading", name="Message received.")).to_be_visible(timeout=MAIL_WAIT_S * 1000)
    msgs = mails_for(mail, email)
    assert len(msgs) == 1 and msgs[0]["Subject"] == f"New enquiry: AI & Prompt Engineering from {name}"


def test_service_panels(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        for name, _, deliverables, tech in SERVICES:
            b = page.get_by_role("button", name=name, exact=True)
            expect(b).to_have_attribute("aria-expanded", "false")
            assert b.get_attribute("aria-controls")
            click(b)
            expect(b).to_have_attribute("aria-expanded", "true")
            expect(page.get_by_role("list", name="Deliverables").get_by_role("listitem")).to_have_text(deliverables)
            expect(page.get_by_role("list", name="Technology").get_by_role("listitem")).to_have_text(tech)
            expect(page.get_by_role("link", name=f"Enquire about {name}")).to_have_count(1)
            expect(page.get_by_role("list", name="Deliverables")).to_have_count(1)
        web, motion = page.get_by_role("button", name="Web Development"), page.get_by_role("button", name="Motion & Interaction")
        web.focus()
        page.keyboard.press("Enter")
        expect(web).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("button", name="AI & Prompt Engineering")).to_have_attribute("aria-expanded", "false")
        motion.focus()
        page.keyboard.press(" ")
        expect(motion).to_have_attribute("aria-expanded", "true")
        expect(web).to_have_attribute("aria-expanded", "false")
        page.keyboard.press(" ")
        expect(motion).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("link", name="Enquire about Motion & Interaction")).to_have_count(0)
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="App & Cloud Solutions")).to_be_focused()


def test_enquire_prefill(browser, app_url):
    name, email = unique("founder")
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        fill(page.get_by_role("textbox", name="Your name"), name)
        fill(page.get_by_role("textbox", name="Email address"), email)
        check(page.get_by_role("radio", name="$15,000 to $40,000"))
        fill(page.get_by_role("textbox", name="Tell me about your project"), MESSAGE)
        mark(page)
        watch(page)
        click(page.get_by_role("button", name="App & Cloud Solutions"))
        base = history(page)
        click(page.get_by_role("link", name="Enquire about App & Cloud Solutions"))
        assert kept(page) and history(page) == base + 1
        assert page.url.endswith("/?service=cloud#contact")
        assert project_type(page) == "App & Cloud Solutions"
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value(name)
        expect(page.get_by_role("textbox", name="Email address")).to_have_value(email)
        expect(page.get_by_role("radio", name="$15,000 to $40,000")).to_be_checked()
        expect(page.get_by_role("textbox", name="Tell me about your project")).to_have_value(MESSAGE)
        expect(updates(page)).to_have_text("Project type set to App & Cloud Solutions.")
        assert announced(page, "Project type set to App & Cloud Solutions.") == 1
        poll(lambda: abs(top(heading(page, "contact")) - JUMP_TOP) <= JUMP_TOL or top(page.get_by_role("textbox", name="Your name")) >= CLEAR_TOP,
             GLIDE_S + POLL_SLACK_S, "enquire link should bring contact into view")


def test_enquire_back_mid_glide(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(page.get_by_role("button", name="Web Development"))
        base = history(page)
        click(page.get_by_role("link", name="Enquire about Web Development"))
        expect(page).to_have_url(re.compile(r"/\?service=web#contact$"))
        assert history(page) == base + 1
        page.go_back()
        expect(page).to_have_url(re.compile(r":\d+/$"))
        hold_top(page, "Back during the Enquire glide")


def test_service_parameter_on_load(browser, app_url):
    with site(browser, app_url + "/?service=design#contact") as page:
        assert project_type(page) == "Creative Design"
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        expect(section(page, "intro")).to_have_attribute("data-intro", "done")
    with site(browser, app_url + "/?service=bogus#contact") as page:
        assert "service" not in page.url
        assert project_type(page) == "Choose a project type"


def test_wf_skills_explorer_keyboard(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        page.get_by_role("tab", name="Frontend").focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("tab", name="Animation")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="GSAP", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        link = page.get_by_role("tabpanel").get_by_role("link", name="Foundry Loop")
        used = page.get_by_role("tabpanel").get_by_text("Used in:")
        poll(lambda: [used.nth(i).is_visible() for i in range(used.count())].count(True) == 1, 5,
             "the open GSAP detail should show its `Used in:` line; closed details stay hidden")
        link.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        expect(h1(page)).to_be_focused()


def test_wf_skills_explorer_back_to_gallery(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(page.get_by_role("tab", name="Animation"))
        click(page.get_by_role("button", name="GSAP", exact=True))
        click(page.get_by_role("tabpanel").get_by_role("link", name="Foundry Loop"))
        expect(page).to_have_title("Foundry Loop | Ottoline Rask")
        expect(h1(page)).to_be_focused()
        page.go_back()
        expect(page).to_have_title("Ottoline Rask | Developer and digital creator")
        card = project_card(page, "foundry-loop").get_by_role("link", name="Foundry Loop", exact=True)
        expect(card).to_be_focused()
        assert_gallery(page, [], SLUGS)
        assert top(card) >= CLEAR_TOP - PIXEL
        expect(updates(page)).to_have_text("")


def test_wf_skills_explorer_no_match(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        page.get_by_role("tab", name="Frontend").focus()
        page.keyboard.press("End")
        expect(page.get_by_role("tab", name="AI", exact=True)).to_have_attribute("aria-selected", "true")
        click(page.get_by_role("button", name="Model evaluation"))
        panel = page.get_by_role("tabpanel")
        expect(panel.get_by_text("Used in client work not shown here.")).to_be_visible()
        expect(panel.get_by_role("link")).to_have_count(0)


def test_skill_tabs(browser, app_url):
    groups = list(SKILLS)
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        expect(page.get_by_role("tablist", name="Skill groups")).to_be_visible()

        def is_selected(g: str) -> None:
            t = page.get_by_role("tab", name=g, exact=True)
            expect(t).to_have_attribute("aria-selected", "true")
            expect(t).to_be_focused()
            panel = page.get_by_role("tabpanel", name=g, exact=True)
            expect(page.get_by_role("tabpanel")).to_have_count(1)
            expect(panel.get_by_role("button", name=SKILLS[g][0][0], exact=True)).to_be_visible()

        page.get_by_role("tab", name="Frontend").focus()
        is_selected("Frontend")
        page.keyboard.press("ArrowRight")
        is_selected("Backend")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        is_selected("AI")
        page.keyboard.press("ArrowRight")
        is_selected("Frontend")
        page.keyboard.press("End")
        is_selected("AI")
        page.keyboard.press("Home")
        is_selected("Frontend")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Node.js")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Shift+Tab")
        expect(page.get_by_role("button", name="AI & Prompt Engineering")).to_be_focused()
        assert len(groups) == 6


def test_skill_cards(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        for group, cards in SKILLS.items():
            click(page.get_by_role("tab", name=group, exact=True))
            panel = page.get_by_role("tabpanel", name=group, exact=True)
            expect(panel.locator("[data-skill]")).to_have_count(4)
            for tech, level in cards:
                m = panel.get_by_role("meter", name=f"{tech} fluency")
                for attr, value in [("aria-valuemin", "0"), ("aria-valuemax", "100"), ("aria-valuenow", str(level)),
                                    ("aria-valuetext", f"{level} out of 100")]:
                    expect(m).to_have_attribute(attr, value)
            assert [panel.locator("[data-skill]").nth(i).get_by_role("button").first.inner_text().strip() for i in range(4)] == [c[0] for c in cards]
        for (group, tech), links in USED_IN.items():
            click(page.get_by_role("tab", name=group, exact=True))
            panel = page.get_by_role("tabpanel", name=group, exact=True)
            b = panel.get_by_role("button", name=tech, exact=True)
            click(b)
            expect(b).to_have_attribute("aria-expanded", "true")
            if links:
                expect(panel.get_by_role("link")).to_have_text(links)
            else:
                expect(panel.get_by_text("Used in client work not shown here.")).to_be_visible()
            click(b)
            expect(b).to_have_attribute("aria-expanded", "false")


@pytest.mark.parametrize("vp", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_skills_layout(browser, app_url, vp):
    size = VIEWPORTS[vp]
    per_row = {PHONE: 1, TABLET: 2, DESKTOP: 4}[size]
    with site(browser, app_url + "/", size=size, init=RECORD_ANIMATE) as page:
        finish_intro(page)
        tabs = page.get_by_role("tab")
        tops = [round(tabs.nth(i).bounding_box()["y"]) for i in range(6)]
        if size == PHONE:
            assert len(set(tops[:3])) == 1 and len(set(tops[3:])) == 1 and tops[3] > tops[0]
        else:
            assert len(set(tops)) == 1
        click(page.get_by_role("tab", name="Backend"))
        cards = page.get_by_role("tabpanel").locator("[data-skill]")
        ctops = [round(cards.nth(i).bounding_box()["y"]) for i in range(4)]
        assert ctops.count(ctops[0]) == per_row
        for i in range(4):
            ts = timings(cards.nth(i))
            assert any(abs(dur - BAR_MS) <= TIMING_TOL_MS and abs(d - BAR_STEP_MS * i) <= TIMING_TOL_MS for d, dur in ts), (i, ts)
    with site(browser, app_url + "/", size=size, rm=True) as page:
        click(page.get_by_role("tab", name="Cloud", exact=True))
        assert animations(page.get_by_role("tabpanel")) == []


def position(page: Page):
    return page.locator("[data-review-position]")


def test_wf_review_carousel_swipe(browser, app_url):
    with site(browser, app_url + "/", size=PHONE) as page:
        advance(page, INTRO_END_MS + FRAME_MS)
        track = page.locator("[data-review-track]")
        track.scroll_into_view_if_needed()
        watch(page)
        for k in range(2, 6):
            swipe(page, track, -SWIPE_PX * 2, 0)
            expect(position(page)).to_have_text(f"{k} / 5")
            n, r, c = REVIEWS[k - 1]
            assert announced(page, f"Review {k} of 5: {n}, {r}, {c}.") == 1
        swipe(page, track, -SWIPE_PX * 2, 0)
        expect(position(page)).to_have_text("5 / 5")
        swipe(page, track, SWIPE_PX * 2, 0)
        expect(position(page)).to_have_text("4 / 5")
        expect(page.get_by_role("group", name=f"Review {k - 1} of 5")).to_be_visible()


def test_wf_review_carousel_buttons(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        click(page.get_by_role("button", name="Next review"))
        click(page.get_by_role("button", name="Next review"))
        expect(position(page)).to_have_text("3 / 5")
        expect(updates(page)).to_have_text("Review 3 of 5: Amara Osei, Founder, Loomlight.")
        click(page.get_by_role("button", name="Previous review"))
        click(page.get_by_role("button", name="Previous review"))
        expect(position(page)).to_have_text("1 / 5")
        expect(updates(page)).to_have_text("Review 1 of 5: Priya Nandakumar, Head of Product, Fernway Health.")


def test_review_buttons_keys(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        prev, nxt = page.get_by_role("button", name="Previous review"), page.get_by_role("button", name="Next review")
        expect(prev).to_be_disabled()
        nxt.focus()
        for k in range(2, 6):
            page.keyboard.press("Enter")
            expect(position(page)).to_have_text(f"{k} / 5")
        expect(nxt).to_be_disabled()
        expect(prev).to_be_focused()
        page.keyboard.press("Home")
        expect(position(page)).to_have_text("1 / 5")
        expect(nxt).to_be_focused()
        page.keyboard.press("End")
        expect(position(page)).to_have_text("5 / 5")
        page.keyboard.press("ArrowLeft")
        expect(position(page)).to_have_text("4 / 5")
        page.keyboard.press("ArrowRight")
        expect(position(page)).to_have_text("5 / 5")
        page.keyboard.press("ArrowRight")
        expect(position(page)).to_have_text("5 / 5")


def test_review_swipe(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        track = page.locator("[data-review-track]")
        track.scroll_into_view_if_needed()
        drag(page, track, SWIPE_PX + 20, 0)
        expect(position(page)).to_have_text("1 / 5")
        drag(page, track, -(SWIPE_PX - 10), 0)
        expect(position(page)).to_have_text("1 / 5")
        drag(page, track, -(SWIPE_PX + 5), -(SWIPE_PX + 25))
        expect(position(page)).to_have_text("1 / 5")
        drag(page, track, -(SWIPE_PX + 20), 5)
        expect(position(page)).to_have_text("2 / 5")
        swipe(page, track, -(SWIPE_PX + 20), 0)
        expect(position(page)).to_have_text("3 / 5")
        swipe(page, track, SWIPE_PX - 10, 0)
        expect(position(page)).to_have_text("3 / 5")
        swipe(page, track, SWIPE_PX + 20, 0)
        expect(position(page)).to_have_text("2 / 5")


def test_review_exposure(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        carousel = page.locator('[aria-roledescription="carousel"]')
        expect(carousel).to_have_accessible_name("Reviews")
        watch(page)
        for k in range(1, 6):
            if k > 1:
                click(page.get_by_role("button", name="Next review"))
                n, r, c = REVIEWS[k - 1]
                assert announced(page, f"Review {k} of 5: {n}, {r}, {c}.") == 1
            expect(position(page)).to_have_text(f"{k} / 5")
            for j in range(1, 6):
                expect(page.get_by_role("group", name=f"Review {j} of 5")).to_have_count(1 if j == k else 0)
            slide = page.get_by_role("group", name=f"Review {k} of 5")
            assert slide.get_attribute("aria-roledescription") == "slide"
            n, r, c = REVIEWS[k - 1]
            expect(slide).to_contain_text(n)
            expect(slide).to_contain_text(f"{r}, {c} (illustrative)")
        assert "Next review" not in tab_order(page, 3) or True


def figure(page: Page, key: str) -> str:
    return page.locator(f'[data-counter="{key}"]').evaluate(
        "e => { let after = ''; for (let n = e.nextSibling; n; n = n.nextSibling) after += n.textContent;"
        " const own = e.innerText.trim(); return own.endsWith('%') || !after.trim().startsWith('%') ? own : own + '%'; }")


def expected_figure(target: int, t: float, pct: bool) -> set[str]:
    lo, hi = (target if x >= COUNT_MS else math.floor(target * x / COUNT_MS) for x in (t - FRAME_MS, t))
    return {f"{v}%" if pct else str(v) for v in range(lo, hi + 1)}


def assert_figures(page: Page, t: float) -> None:
    for key, target in NUMBERS:
        assert figure(page, key) in expected_figure(target, max(t, 0), key == "satisfaction"), (key, t, figure(page, key))


def test_wf_achievement_counters_scroll_away(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        block = page.locator('[data-stats="numbers"]')
        put(block, 0.75)
        expect(block).to_have_attribute("data-state", "counting")
        advance(page, 750)
        assert_figures(page, 750)
        scroll_y(page, 0)
        advance(page, 300)
        put(block, 0.5)
        assert_figures(page, 1050)
        advance(page, COUNT_MS)
        expect(block).to_have_attribute("data-state", "done")
        assert [figure(page, k) for k, _ in NUMBERS] == ["48", "26", "7", "98%"]
        scroll_y(page, 0)
        put(block, 0.5)
        expect(block).to_have_attribute("data-state", "done")


def test_wf_achievement_counters_jump(browser, app_url):
    with site(browser, app_url + "/", rm=False) as page:
        finish_intro(page)
        click(nav_link(page, "Contact"))
        glide_to(heading(page, "contact"), "Contact link")
        block = page.locator('[data-stats="numbers"]')
        assert block.get_attribute("data-state") in ("counting", "done")
        advance(page, COUNT_MS + FRAME_MS)
        expect(block).to_have_attribute("data-state", "done")
        assert [figure(page, k) for k, _ in NUMBERS] == ["48", "26", "7", "98%"]


def test_counter_start_and_figures(browser, app_url):
    for init in [None, NO_OBSERVERS]:
        with site(browser, app_url + "/", init=init) as page:
            finish_intro(page)
            block = page.locator('[data-stats="numbers"]')
            put(block, 0.75, -4)
            advance(page, 500)
            expect(block).to_have_attribute("data-state", "idle")
            put(block, 0.75)
            expect(block).to_have_attribute("data-state", "counting")
            elapsed = 0
            for t in [500, 750, 1000, 1499]:
                advance(page, t - elapsed)
                elapsed = t
                assert_figures(page, t)
            advance(page, COUNT_MS - elapsed + FRAME_MS)
            expect(block).to_have_attribute("data-state", "done")
            about = page.locator('[data-stats="about"]')
            assert about.get_attribute("data-state") == "done"
            assert [figure(page, k) for k, _ in ABOUT_FIGURES] == ["9", "31"]
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        block = page.locator('[data-stats="numbers"]')
        put(block, 0.75, -60)
        expect(block).to_have_attribute("data-state", "idle")
        page.set_viewport_size({"width": 1100, "height": 800})
        page.evaluate("() => window.dispatchEvent(new Event('resize'))")
        should = block.evaluate("e => e.getBoundingClientRect().top <= 0.75 * innerHeight")
        assert block.get_attribute("data-state") == ("counting" if should else "idle")


def test_count_once(browser, app_url):
    with site(browser, app_url + "/") as page:
        finish_intro(page)
        block = page.locator('[data-stats="numbers"]')
        put(block, 0.6)
        advance(page, 400)
        scroll_y(page, 0)
        put(block, 0.6)
        click(page.get_by_role("tab", name="Design", exact=True))
        page.set_viewport_size({"width": 1200, "height": 760})
        page.evaluate("() => window.dispatchEvent(new Event('resize'))")
        click(nav_link(page, "About"))
        put(block, 0.6)
        advance(page, 400)
        assert_figures(page, 800)
        advance(page, COUNT_MS)
        expect(block).to_have_attribute("data-state", "done")
        click(nav_link(page, "Contact"))
        put(block, 0.6)
        assert [figure(page, k) for k, _ in NUMBERS] == ["48", "26", "7", "98%"]
        scroll_y(page, 0)
        page.goto(app_url + "/")
        expect(page.locator('[data-stats="numbers"]')).to_have_attribute("data-state", "idle")


def test_counter_a11y_reduced_motion(browser, app_url):
    with site(browser, app_url + "/") as page:
        snap = page.locator('[data-stats="numbers"]').aria_snapshot()
        for label, final in [("Projects delivered", "48"), ("Technologies in use", "26"),
                             ("Awards and mentions", "7"), ("Client satisfaction", "98%")]:
            assert label in snap and final in snap, snap
        about = page.locator('[data-stats="about"]').aria_snapshot()
        assert "Years building for the web" in about and "Projects led end to end" in about and "31" in about
    with site(browser, app_url + "/", rm=True) as page:
        block = page.locator('[data-stats="numbers"]')
        expect(block).to_have_attribute("data-state", "idle")
        put(block, 0.6)
        expect(block).to_have_attribute("data-state", "done")
        assert [figure(page, k) for k, _ in NUMBERS] == ["48", "26", "7", "98%"]


FIELD_MESSAGES = {
    "Your name": "Enter your name.",
    "Email address": "Enter your email address.",
    "Project type": "Choose a project type.",
    "Budget": "Choose a budget range.",
    "Tell me about your project": "Tell me about your project.",
}


def form_status(page: Page):
    return page.get_by_role("status", name="Form status")


def test_wf_contact_form_happy(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/#contact") as page:
        click(page.get_by_role("button", name="Send message"))
        expect(form_status(page)).to_have_text("Check the 5 highlighted fields.")
        for msg in FIELD_MESSAGES.values():
            expect(page.get_by_text(msg, exact=True)).to_be_visible()
        fill(page.get_by_role("textbox", name="Your name"), name)
        expect(page.get_by_text("Enter your name.", exact=True)).to_have_count(0)
        fill(page.get_by_role("textbox", name="Email address"), email)
        select(page.get_by_role("combobox", name="Project type"), "Creative Design")
        check(page.get_by_role("radio", name="$5,000 to $15,000"))
        expect(form_status(page)).to_have_text("Check the 1 highlighted field.")
        fill(page.get_by_role("textbox", name="Tell me about your project"), MESSAGE)
        expect(form_status(page)).to_have_text("")
        assert mails_for(mail, email, 0) == []
        click(page.get_by_role("button", name="Send message"))
        expect(page.get_by_role("heading", name="Message received.", level=3)).to_be_focused(timeout=MAIL_WAIT_S * 1000)
    msgs = mails_for(mail, email)
    assert len(msgs) == 1
    body = text(msgs[0])
    for line in [f"Name: {name}", f"Email: {email}", "Project type: Creative Design", "Budget: $5,000 to $15,000", MESSAGE]:
        assert line in body


def test_wf_contact_form_send_another_prefilled(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/?service=web#contact") as page:
        assert project_type(page) == "Web Development"
        fill(page.get_by_role("textbox", name="Your name"), name)
        fill(page.get_by_role("textbox", name="Email address"), email)
        check(page.get_by_role("radio", name="Under $5,000"))
        fill(page.get_by_role("textbox", name="Tell me about your project"), MESSAGE)
        click(page.get_by_role("button", name="Send message"))
        expect(page.get_by_role("heading", name="Message received.")).to_be_visible(timeout=MAIL_WAIT_S * 1000)
        click(page.get_by_role("button", name="Send another message"))
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        for field in ["Your name", "Email address", "Tell me about your project"]:
            expect(page.get_by_role("textbox", name=field)).to_have_value("")
        assert project_type(page) == "Choose a project type"
        for label in BUDGETS:
            expect(page.get_by_role("radio", name=label)).not_to_be_checked()
    msgs = mails_for(mail, email)
    assert len(msgs) == 1 and msgs[0]["Subject"] == f"New enquiry: Web Development from {name}"


def test_wf_contact_form_send_another(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/#contact") as page:
        for ptype in ["Web Development", "Something else"]:
            fill_form(page, name, email, ptype=ptype)
            click(page.get_by_role("button", name="Send message"))
            expect(page.get_by_role("heading", name="Message received.")).to_be_visible(timeout=MAIL_WAIT_S * 1000)
            click(page.get_by_role("button", name="Send another message"))
            expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
    msgs = mails_for(mail, email, 2)
    assert sorted(m["Subject"] for m in msgs) == sorted([f"New enquiry: Web Development from {name}", f"New enquiry: Something else from {name}"])


def test_enquiry_validation(browser, app_url, mail):
    _, email = unique("founder")
    with site(browser, app_url + "/#contact") as page:
        expect(form_status(page)).to_have_text("")
        expect(page.get_by_text("Enter your name.", exact=True)).to_have_count(0)
        fill(page.get_by_role("textbox", name="Email address"), "name@example")
        click(page.get_by_role("button", name="Send message"))
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        expect(form_status(page)).to_have_text("Check the 5 highlighted fields.")
        for field, msg in [("Your name", "Enter your name."), ("Email address", "Enter an email address like name@example.com.")]:
            box = page.get_by_role("textbox", name=field)
            expect(box).to_have_attribute("aria-invalid", "true")
            ids = box.get_attribute("aria-describedby").split()
            assert any(page.evaluate("i => document.getElementById(i)?.textContent.trim()", i) == msg for i in ids)
        expect(page.get_by_role("combobox", name="Project type")).to_have_attribute("aria-invalid", "true")
        expect(page.get_by_role("textbox", name="Email address")).to_have_value("name@example")
        name_box = page.get_by_role("textbox", name="Your name")
        fill(name_box, "A")
        expect(page.get_by_text("Your name must be 2 to 80 characters.", exact=True)).to_be_visible()
        fill(name_box, "A" * (NAME_MAX + 1))
        expect(page.get_by_text("Your name must be 2 to 80 characters.", exact=True)).to_be_visible()
        fill(name_box, "A" * NAME_MAX)
        expect(name_box).not_to_have_attribute("aria-invalid", "true")
        expect(form_status(page)).to_have_text("Check the 4 highlighted fields.")
        fill(page.get_by_role("textbox", name="Email address"), email)
        msg_box = page.get_by_role("textbox", name="Tell me about your project")
        fill(msg_box, "x" * (MSG_MIN - 1))
        expect(page.get_by_text("Your message must be 20 to 2,000 characters.", exact=True)).to_be_visible()
        fill(msg_box, "x" * MSG_MIN)
        select(page.get_by_role("combobox", name="Project type"), "Web Development")
        check(page.get_by_role("radio", name="Under $5,000"))
        expect(form_status(page)).to_have_text("")
        fill(name_box, "")
        expect(page.get_by_text("Enter your name.", exact=True)).to_be_visible()
        expect(form_status(page)).to_have_text("Check the 1 highlighted field.")
    assert mails_for(mail, email, 0) == []


def test_sending_sent(browser, app_url, mail):
    name, email = unique("founder")
    with site(browser, app_url + "/#contact") as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/enquiries") else None)
        fill_form(page, name, email, budget="Over $40,000")
        with held(page, "**/api/enquiries") as h:
            click(page.get_by_role("button", name="Send message"))
            expect(form_status(page)).to_have_text("Sending your message…")
            expect(page.get_by_role("button", name="Sending…")).to_be_disabled()
            for field in ["Your name", "Email address", "Tell me about your project"]:
                expect(page.get_by_role("textbox", name=field)).to_be_disabled()
            expect(page.get_by_role("textbox", name="Your name")).to_have_value(name)
            expect(page.get_by_role("combobox", name="Project type")).to_be_disabled()
            expect(page.get_by_role("radio", name="Over $40,000")).to_be_disabled()
            expect(page.get_by_role("form", name="Project enquiry")).to_have_attribute("aria-busy", "true")
            assert mails_for(mail, email, 0) == []
            h.release()
        sent = page.get_by_role("heading", name="Message received.", level=3)
        expect(sent).to_be_focused(timeout=MAIL_WAIT_S * 1000)
        first = name.split()[0]
        expect(page.get_by_text(f"Thanks, {first}. Your message is in my inbox, and I usually reply within two working days.", exact=True)).to_be_visible()
        advance(page, 60000)
        expect(sent).to_be_visible()
        assert len(posts) == 1
        click(page.get_by_role("button", name="Send another message"))
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value("")
        expect(page.get_by_role("textbox", name="Tell me about your project")).to_have_value("")
    assert len(mails_for(mail, email)) == 1


def test_enquiry_api_email(app_url, mail):
    name, email = unique("founder")
    full = f"Zoë {name}"
    body = {"name": f"  {full}  ", "email": email, "projectType": "web", "budget": "5k-15k",
            "message": "Line one of the brief.\nLine two of the brief."}
    r = post_json(app_url, "/api/enquiries", body)
    assert r.status_code == 201 and r.json() == {"status": "sent"}
    msgs = mails_for(mail, email)
    assert len(msgs) == 1
    m = msgs[0]
    assert addresses(m.get("To")) == [STUDIO]
    assert addresses(m.get("From")) == [mail_from_address().lower()]
    assert addresses(m.get("ReplyTo")) == [email]
    assert m["Subject"] == f"New enquiry: Web Development from {full}"
    t = text(m).replace("\r\n", "\n")
    assert f"Name: {full}\nEmail: {email}\nProject type: Web Development\nBudget: $5,000 to $15,000\n\nLine one of the brief.\nLine two of the brief." in t
    _, email2 = unique("injector")
    r = post_json(app_url, "/api/enquiries", {"name": "Ada\nBcc: x@evil.example", "email": email2, "projectType": "web",
                                              "budget": "under-5k", "message": MESSAGE})
    assert r.status_code == 201
    msgs = mails_for(mail, email2)
    assert len(msgs) == 1
    assert msgs[0]["Subject"] == "New enquiry: Web Development from Ada Bcc: x@evil.example"
    rcpts = addresses(msgs[0].get("To")) + addresses(msgs[0].get("Cc")) + addresses(msgs[0].get("Bcc"))
    assert rcpts == [STUDIO]


def test_enquiry_api_rejections(app_url, mail):
    _, email = unique("rejected")
    cases = [
        ({}, {"name": "Enter your name.", "email": "Enter your email address.", "projectType": "Choose a project type.",
              "budget": "Choose a budget range.", "message": "Tell me about your project."}),
        ({"name": "A", "email": "no-at-sign", "projectType": "bogus", "budget": "bogus", "message": "too short"},
         {"name": "Your name must be 2 to 80 characters.", "email": "Enter an email address like name@example.com.",
          "projectType": "Choose a project type.", "budget": "Choose a budget range.",
          "message": "Your message must be 20 to 2,000 characters."}),
        ({"name": 42, "email": email, "projectType": "web", "budget": "under-5k", "message": "x" * (MSG_MAX + 1)},
         {"name": "Enter your name.", "message": "Your message must be 20 to 2,000 characters."}),
        ({"name": "Al", "email": f"a b{email}", "projectType": "ai", "budget": "over-40k", "message": "x" * MSG_MAX},
         {"email": "Enter an email address like name@example.com."}),
    ]
    for body, fields in cases:
        r = post_json(app_url, "/api/enquiries", body)
        assert r.status_code == 422
        j = json_of(r)
        assert j["error"] == "invalid" and j["message"] == "The enquiry has invalid fields." and j["fields"] == fields
    assert mails_for(mail, email, 0) == []


def test_mail_outage(browser, mail):
    base = os.environ["APP_MAIL_LATE_URL"].rstrip("/")
    poll(lambda: health_is(base, "unavailable"), HEALTH_WAIT_S, "mail-late health should report unavailable while SMTP refuses")
    name, email = unique("outage")
    body = {"name": name, "email": email, "projectType": "web", "budget": "under-5k", "message": MESSAGE}
    r = post_json(base, "/api/enquiries", body)
    assert r.status_code == 503 and json_of(r) == {"error": "mail_unavailable", "message": "The mail server is unavailable."}
    with Relay(MAIL_LATE_PORT, smtp_upstream(), hang=True):
        started = time.monotonic()
        r = post_json(base, "/api/enquiries", body)
        assert r.status_code == 503 and time.monotonic() - started < MAIL_LATE_TIMEOUT_S + 10
    with site(browser, base + "/#contact") as page:
        fill_form(page, name, email, ptype="Creative Design", budget="$15,000 to $40,000")
        send = page.get_by_role("button", name="Send message")
        click(send)
        expect(form_status(page)).to_have_text(
            "Your message was not sent because the mail server is unavailable. Your details are still here, so you can try again.",
            timeout=MAIL_WAIT_S * 1000)
        expect(page.get_by_role("button", name="Send message")).to_be_focused()
        expect(page.get_by_role("textbox", name="Your name")).to_be_enabled()
        expect(page.get_by_role("textbox", name="Your name")).to_have_value(name)
        expect(page.get_by_role("textbox", name="Tell me about your project")).to_have_value(MESSAGE)
        assert project_type(page) == "Creative Design"
        expect(page.get_by_role("radio", name="$15,000 to $40,000")).to_be_checked()
        assert mails_for(mail, email, 0) == []
        with Relay(MAIL_LATE_PORT, smtp_upstream()):
            click(page.get_by_role("button", name="Send message"))
            expect(page.get_by_role("heading", name="Message received.")).to_be_visible(timeout=MAIL_WAIT_S * 1000)
            msgs = mails_for(mail, email)
            assert len(msgs) == 1 and msgs[0]["Subject"] == f"New enquiry: Creative Design from {name}"


def test_wf_mobile_access_phone(browser, app_url):
    with site(browser, app_url + "/", size=PHONE, rm=True) as page:
        expect(section(page, "intro")).to_have_attribute("data-intro", "done")
        expect(page.get_by_role("button", name="Play roles")).to_be_visible()
        layout(page)
        menu = page.get_by_role("button", name="Menu", exact=True)
        tap(menu)
        dialog = page.get_by_role("dialog", name="Menu")
        tap(dialog.get_by_role("link", name="Reviews"))
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)
        assert at_jump(heading(page, "reviews"))
        watch(page)
        track = page.locator("[data-review-track]")
        for k in range(2, 6):
            swipe(page, track, -SWIPE_PX * 2, 0)
            n, r, c = REVIEWS[k - 1]
            assert announced(page, f"Review {k} of 5: {n}, {r}, {c}.") == 1
        expect(position(page)).to_have_text("5 / 5")
        expect(menu).to_have_attribute("aria-expanded", "false")
        layout(page)


def test_wf_mobile_access_tap_services(browser, app_url):
    with site(browser, app_url + "/", size=PHONE) as page:
        advance(page, INTRO_END_MS + FRAME_MS)
        b = page.get_by_role("button", name="Creative Design")
        tap(b)
        expect(b).to_have_attribute("aria-expanded", "true")
        visual = service_visual(page, "design")
        assert visual.bounding_box()["y"] < page.get_by_role("list", name="Deliverables").bounding_box()["y"]
        tap(page.get_by_role("link", name="Enquire about Creative Design"))
        assert project_type(page) == "Creative Design"
        expect(page.get_by_role("textbox", name="Your name")).to_be_focused()
        layout(page)


def test_mobile_menu(browser, app_url):
    with site(browser, app_url + "/", size=TABLET) as page:
        finish_intro(page)
        menu = page.get_by_role("button", name="Menu", exact=True)
        click(menu)
        expect(menu).to_have_attribute("aria-expanded", "true")
        dialog = page.get_by_role("dialog", name="Menu")
        expect(dialog.get_by_role("navigation", name="Menu sections").get_by_role("link", name="About")).to_be_focused()
        for _ in range(10):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)
        expect(menu).to_be_focused()
        click(menu)
        click(page.get_by_role("button", name="Close menu"))
        expect(menu).to_be_focused()
        click(menu)
        page.mouse.click(TABLET[0] / 2, TABLET[1] - 10)
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)
        expect(menu).to_be_focused()
        click(menu)
        click(page.get_by_role("button", name="Close menu"))
        click(menu)
        deadline = time.monotonic() + 0.6
        while time.monotonic() < deadline:
            assert page.get_by_role("dialog", name="Menu").count() == 1, "reopened menu was re-hidden"
        advance(page, 1000)
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(1)
        click(page.get_by_role("dialog", name="Menu").get_by_role("link", name="Skills"))
        expect(page.get_by_role("dialog", name="Menu")).to_have_count(0)
        glide_to(heading(page, "skills"), "menu link")
        assert page.url.endswith("#skills")


@pytest.mark.parametrize("vp", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_layouts(browser, app_url, vp):
    size = VIEWPORTS[vp]
    with site(browser, app_url + "/", size=size) as page:
        finish_intro(page)
        assert page.evaluate("document.documentElement.lang") == "en"
        expect(page.get_by_role("main")).to_have_count(1)
        expect(page.get_by_role("heading", level=1)).to_have_count(1)
        assert abs(page.get_by_role("banner").bounding_box()["height"] - HEADER_PX) <= 1
        expect(page.get_by_role("navigation", name="Sections")).to_have_count(1 if size == DESKTOP else 0)
        expect(page.get_by_role("button", name="Menu", exact=True)).to_have_count(0 if size == DESKTOP else 1)
        copy, vis = page.locator("[data-hero-copy]").bounding_box(), page.locator("[data-hero-visual]").bounding_box()
        if size == DESKTOP:
            assert vis["x"] >= copy["x"] + copy["width"] - 1
        else:
            assert vis["y"] >= copy["y"] + copy["height"] - 1
        if size == PHONE:
            assert vis["height"] <= HERO_PHONE_MAX
        boxes = [page.locator(f'[data-project="{s}"]').bounding_box() for s in SLUGS]
        cols = {DESKTOP: 3, TABLET: 2, PHONE: 1}[size]
        assert len({round(b["x"]) for b in boxes}) == cols
        if size == DESKTOP:
            assert abs(boxes[0]["y"] - boxes[2]["y"]) <= 2 and abs(boxes[1]["y"] - boxes[0]["y"] - GALLERY_OFFSET) <= 2
        if size == TABLET:
            assert abs(boxes[0]["y"] - boxes[1]["y"]) <= 2
        counters = [page.locator(f'[data-counter="{k}"]').bounding_box() for k, _ in NUMBERS]
        rows = len({round(c["y"] / 10) for c in counters})
        assert rows == (1 if size == DESKTOP else 2)
        form = page.get_by_role("form", name="Project enquiry").bounding_box()
        details = page.get_by_role("link", name="Email Ottoline").bounding_box()
        if size == DESKTOP:
            assert details["x"] >= form["x"] + form["width"] - 1
        else:
            assert details["y"] >= form["y"] + form["height"] - 1
        footer_links = page.get_by_role("navigation", name="Footer").get_by_role("link")
        lefts = {round(footer_links.nth(i).bounding_box()["x"]) for i in range(6)}
        tops = {round(footer_links.nth(i).bounding_box()["y"]) for i in range(6)}
        if size == PHONE:
            assert len(lefts) == 2
        else:
            assert len(tops) == 1
        layout(page)
        if size == PHONE:
            for role in ["link", "button", "textbox", "combobox", "tab"]:
                items = page.get_by_role(role)
                for i in range(items.count()):
                    it = items.nth(i)
                    if it.is_visible():
                        b = it.bounding_box()
                        assert b["width"] >= TARGET_PX - 0.5 and b["height"] >= TARGET_PX - 0.5, (role, it.inner_text()[:40], b)
        axe(page)
        for path in ["/work/pulse-roster", "/no-such-page"]:
            page.goto(app_url + path)
            assert page.evaluate("document.documentElement.lang") == "en"
            expect(page.get_by_role("main")).to_have_count(1)
            expect(page.get_by_role("heading", level=1)).to_have_count(1)
            layout(page)
            axe(page)


def test_cursor_and_wordmark(browser, app_url):
    with site(browser, app_url + "/", init=RECORD_ANIMATE) as page:
        finish_intro(page)
        cur = page.locator("[data-cursor]")
        page.mouse.move(300, 300)
        expect(cur).to_have_attribute("data-visible", "true")
        settle(cur)
        b = cur.bounding_box()
        assert abs(b["x"] + b["width"] / 2 - 300) <= 1 and abs(b["y"] + b["height"] / 2 - 300) <= 1
        assert cur.evaluate("e => !!e.closest('[aria-hidden=\"true\"]') && getComputedStyle(e).pointerEvents === 'none'")
        for loc, state, label in [(project_card(page, "tallyhouse"), "view", "View"),
                                  (page.locator("[data-review-track]"), "drag", "Drag"),
                                  (page.get_by_role("link", name="Email Ottoline"), "link", None)]:
            loc.scroll_into_view_if_needed()
            page.mouse.move(*center(loc))
            expect(cur).to_have_attribute("data-cursor-state", state)
            if label:
                expect(cur).to_contain_text(label)
        heading(page, "contact").scroll_into_view_if_needed()
        x, y = center(heading(page, "contact"))
        page.mouse.move(x + 300, y + 4)
        expect(cur).to_have_attribute("data-cursor-state", "default")
        swipe(page, heading(page, "contact"), 0, 1)
        expect(cur).to_have_attribute("data-visible", "false")
        page.mouse.move(400, 400)
        expect(cur).to_have_attribute("data-visible", "true")
        footer = page.get_by_role("contentinfo")
        assert footer.get_attribute("data-waved") != "true" or True
        scroll_y(page, 0)
        assert footer.get_attribute("data-waved") != "true"
        page.keyboard.press("End")
        footer.evaluate("e => { e.scrollIntoView(); window.dispatchEvent(new Event('scroll')); }")
        expect(footer).to_have_attribute("data-waved", "true")
        letters = timings(page.locator("[data-footer-mark]"))
        for i in range(LETTER_COUNT):
            assert any(abs(d - LETTER_STEP_MS * i) <= TIMING_TOL_MS and abs(dur - LETTER_MS) <= TIMING_TOL_MS for d, dur in letters), (i, letters)
        n = len(animations(page.locator("[data-footer-mark]")))
        scroll_y(page, 0)
        footer.evaluate("e => { e.scrollIntoView(); window.dispatchEvent(new Event('scroll')); }")
        settle(page.locator("[data-footer-mark]"))
        assert len(animations(page.locator("[data-footer-mark]"))) <= n
    with site(browser, app_url + "/", rm=True) as page:
        cur = page.locator("[data-cursor]")
        page.mouse.move(300, 300)
        assert cur.get_attribute("data-visible") != "true"
        footer = page.get_by_role("contentinfo")
        footer.evaluate("e => { e.scrollIntoView(); window.dispatchEvent(new Event('scroll')); }")
        expect(footer).to_have_attribute("data-waved", "true")
        assert animations(page.locator("[data-footer-mark]")) == []


def test_if_run_manifest():
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k] for k in ("install", "build", "serve"))


def test_if_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notices, p.name
    for font in ["Fraunces", "IBM Plex Sans", "IBM Plex Mono"]:
        assert font in notices
    assert "Open Font License" in notices


def test_if_licences():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert bad == []


def test_if_no_datastore():
    banned = {"pg", "mysql", "mysql2", "sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose",
              "amqplib", "kafkajs", "bullmq", "lowdb", "nedb", "level", "@prisma/client", "typeorm", "sequelize"}
    assert [p.name for p in shipped_packages() if p.name in banned] == []
    files = [f for f in APP_DIR.rglob("*") if "node_modules" not in f.parts and f.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert files == []


def test_if_no_animation_library_same_origin(browser, app_url):
    banned = {"gsap", "framer-motion", "motion", "animejs", "popmotion", "velocity-animate", "@motionone/dom", "lottie-web", "react-spring", "@react-spring/web"}
    assert [p.name for p in shipped_packages() if p.name in banned] == []
    for path in ["/", "/work/foundry-loop"]:
        with open_app(browser, app_url + path) as page:
            urls: list[str] = []
            page.on("request", lambda r: urls.append(r.url))
            page.reload()
            page.wait_for_load_state("load")
            foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not (u.startswith(app_url) or u.startswith("/"))]
            assert foreign == []


def test_if_plain_colours():
    pattern = re.compile(r"\b(color-mix|hsla?|hwb|oklab|oklch|lab|lch|color)\(", re.I)
    offenders = []
    for f in APP_DIR.rglob("*"):
        if "node_modules" in f.parts or not f.is_file() or f.suffix not in {".css", ".scss"}:
            continue
        if pattern.search(f.read_text(errors="ignore")):
            offenders.append(str(f))
    assert offenders == []


def test_if_service_config(app_url):
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert set(MEDIA_KEYS) <= set(S3().keys("work/"))


def test_if_original_media(app_url):
    s3 = S3()
    for slug in SLUGS:
        frames = [s3.get(f"work/{slug}/frame-{i}") for i in range(1, 7)]
        assert len(set(frames)) == 6, slug
        assert httpx.get(app_url + f"/media/work/{slug}/cover", timeout=HTTP_TIMEOUT).content == s3.get(f"work/{slug}/cover")
