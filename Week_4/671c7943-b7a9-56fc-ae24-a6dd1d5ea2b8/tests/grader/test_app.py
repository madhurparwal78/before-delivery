from __future__ import annotations

import copy
import json
import math
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    Mailpit,
    Postgres,
    addresses,
    advance,
    axe,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    style,
    tap,
    text,
    unique,
)


APP = Path("/app")
KEY = os.environ.get("GRADING_KEY", "")
MAIL_DOWN = os.environ.get("APP_MAIL_DOWN_URL", "").rstrip("/")
PDF_DOWN = os.environ.get("APP_PDF_DOWN_URL", "").rstrip("/")

HTTP_S = 30
POLL_S = 10
MAIL_S = 20
ABSENT_S = 4
STEP_MS = 50
SLACK_S = 0.75
SETTLE_MS = 300
TAB_SWEEP = 45
ROW_TOL_PX = 2
LINE_TOL = 0.15
SWIPE_STEPS = 15
SWIPE_STEP_MS = 25


DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
HEADER_PX = 64
CLEAR_PX = 16
FOCUS_TOP_PX = 72
JUMP_MS = 1000
POINT = 0.4
FRAME_MS = 17
COUNT_MS = 1200
COUNT_EDGE = 0.85
COUNT_CHECKS = (300, 600, 900, 1200)
INTRO_LINE_MS = (600, 800)
INTRO_STAGGER_MS = (100, 140)
INTRO_DONE_MS = 1600
HEADING_MS = (500, 700)
HEADING_RISE_PX = 32
HEADING_EDGE = 0.85
PANEL_MS = (280, 360)
COVER_SCALE = 1.04
COVER_SCALE_MS = (300, 400)
CAPTION_MS = (200, 300)
CAPTION_RISE_PX = 8
COVER_REVEAL_MS = (600, 800)
COVER_EDGE = 0.9
FILTER_FADE_MS = (200, 300)
CARRY_MS = (440, 520)
GEOM_TOL_PX = 2
TITLE_RISE_PX = 24
TITLE_MS = (160, 200)
TITLE_STAGGER_MS = (50, 70)
SLIDE_PX = 40
SLIDE_MS = (320, 400)
SHOWCASE_MS = 600
MENU_MS = (200, 350)
PLATE_RATE = 0.25
PLATE_CAP = 800
PLATE_POSITIONS = [0, 400, 800, 1200, 800, 400, 0]
SWIPE_PX = 60
SHORT_SWIPE_PX = SWIPE_PX - 1
LONG_SWIPE_PX = SWIPE_PX * 5
TARGET_PX = 44
RING_PX = 2
RING_CONTRAST = 3
SHARE_TOL_PP = 0.5
CONTACT_TOP_PX = 4
BODY_LIMIT = 262144
ATONCE_MS = 1
DESC_MAX = 2000
DESC_MIN = 40
NAME_MAX = 80
EMAIL_MAX = 254
YEAR_RANGE = (2000, 2026)
HUE_MAX = 359
MAX_PROJECTS = 24
SLUG_MAX = 40
TEXT_MAX = 1200
STAT_MAX = 99999
PROCESS_MAX = 12
BIG_VALUE = 12345
BIG_PARTS = (12000, 345)
BAR_PARTS = (73, 27)
COLUMNS = {1280: 3, 1024: 3, 1023: 2, 768: 2, 600: 2, 599: 1, 375: 1}


TITLE_HOME = "Sollis Studio | Independent designer"
TITLE_PRIVACY = "Privacy | Sollis Studio"
TITLE_NOT_FOUND = "Not found | Sollis Studio"
TITLE_BRIEF_DOWN = "Brief unavailable | Sollis Studio"
SECTION_IDS = ["intro", "about", "services", "work", "philosophy", "contact"]
INTRO_LINES = ["Clear brands.", "Considered websites.", "Products people keep."]
H1_NAME = " ".join(INTRO_LINES)
REGION_NAMES = {
    "intro": H1_NAME,
    "about": "About Maren",
    "services": "Services",
    "work": "Selected work",
    "philosophy": "How I work",
    "contact": "Start a project",
}
NAV_LINKS = {"About": "about", "Services": "services", "Work": "work", "Philosophy": "philosophy", "Contact": "contact"}
INTRO_TEXT = "Maren Sollis is an independent designer working across brand identity, website design and digital product design."
ABOUT_P1 = "I am Maren Sollis, an independent designer. For twelve years I have helped companies find a clear voice and give it a form, from the first mark to the last screen."
ABOUT_P2 = "I work alone on purpose: the person you brief is the person who designs, and I take on four engagements a year."
BACKGROUND = [
    "2014 to 2017 · Designer, Hallam Pike Studio, Bristol",
    "2017 to 2021 · Senior brand designer, Northgate Type Office, Rotterdam",
    "2021 to now · Independent, Sollis Studio, London",
]
SERVICES_LINE = "Three services, one designer from the first workshop to the handover."
PRINCIPLES = [
    ("Say one thing well.", "Every identity, page and screen makes one clear promise before it makes a second."),
    ("Design the system, not the sample.", "A logo, a homepage or a screen is the first use of a system your team will keep using."),
    ("Leave it documented.", "Every project ends with guidelines the next designer can follow without calling me."),
]
CONTACT_LINE = "Tell me about the work. I reply to every enquiry within two working days."
FOOTER_TEXTS = ["Sollis Studio", "Maren Sollis and every client named on this site are fictional.", "© 2026 Sollis Studio. All rights reserved."]
FOOTER_LINKS = [("About", "/#about"), ("Services", "/#services"), ("Work", "/#work"), ("Philosophy", "/#philosophy"), ("Contact", "/#contact"), ("Privacy", "/privacy")]
SOCIAL_LINKS = [
    ("Instagram (opens in a new tab)", "https://instagram.example/sollis.studio"),
    ("LinkedIn (opens in a new tab)", "https://linkedin.example/in/maren-sollis"),
    ("Behance (opens in a new tab)", "https://behance.example/sollis"),
]
STUDIO_EMAIL = "studio@sollis.example"
PHONE_NAME, PHONE_HREF = "+44 20 7946 0321", "tel:+442079460321"
PRIVACY_PARAS = [
    "This site keeps the enquiries you send: your name, email, project type, budget range and description.",
    "Enquiries are used only to reply to you and are deleted after 24 months.",
    "The site sets no cookies and uses no analytics.",
]
PROCESS_STEPS = [
    ("Discover", "Weeks 1 to 2", "Interviews, an audit of what exists and a written brief we both sign."),
    ("Define", "Weeks 3 to 4", "Positioning, principles and the measures we will judge the work by."),
    ("Design", "Weeks 5 to 9", "Two directions, one chosen, then refined in weekly reviews."),
    ("Deliver", "Weeks 10 to 12", "Final files, guidelines and a handover session with your team."),
]
CATS = {"brand-identity": "Brand Identity", "website-design": "Website Design", "digital-product-design": "Digital Product Design"}
TYPES = {**CATS, "not-sure": "Not sure yet"}
BUDGETS = {"under-10k": "Under €10,000", "10k-25k": "€10,000 to €25,000", "25k-50k": "€25,000 to €50,000", "over-50k": "Over €50,000"}
SERVICES = {
    "brand-identity": {
        "summary": "Names, marks and systems that let a company sound and look like itself everywhere.",
        "caps": ["Brand strategy workshops", "Naming and verbal identity", "Logo and wordmark design", "Typography and colour systems", "Brand guidelines"],
        "dels": ["Logo suite in SVG and PNG", "Colour and type specification", "Brand guidelines PDF, 40 to 60 pages", "Stationery and social templates"],
        "weeks": "6 to 10 weeks",
    },
    "website-design": {
        "summary": "Editorial, fast websites that carry a brand's voice and are easy for your team to keep up to date.",
        "caps": ["Site architecture and content design", "Art direction and page design", "Motion and interaction design", "Accessibility review to WCAG 2.2 AA", "Design system for the build team"],
        "dels": ["Sitemap and page templates", "Desktop, tablet and phone designs", "Interactive prototype", "Component library with usage notes"],
        "weeks": "8 to 12 weeks",
    },
    "digital-product-design": {
        "summary": "Clear, testable product interfaces, from first flows to a design system your team can grow.",
        "caps": ["Product discovery and research", "User flows and information architecture", "Interface design", "Usability testing", "Design systems"],
        "dels": ["Research summary", "User flows and wireframes", "High-fidelity screens", "Clickable prototype", "Design system library"],
        "weeks": "10 to 16 weeks",
    },
}

STATS = [
    {"id": "years", "value": 12, "label": "years of practice", "note": "In practice since 2014: seven years in studios, five independent.", "parts": [{"label": "In studios", "value": 7}, {"label": "Independent", "value": 5}]},
    {"id": "projects", "value": 140, "label": "projects delivered", "note": "Across the three services since 2014.", "parts": [{"label": "Brand Identity", "value": 58}, {"label": "Website Design", "value": 47}, {"label": "Digital Product Design", "value": 35}]},
    {"id": "identities", "value": 38, "label": "brand identities launched", "note": "Identities now in use, by company size.", "parts": [{"label": "Over 250 people", "value": 21}, {"label": "250 people or fewer", "value": 17}]},
    {"id": "awards", "value": 9, "label": "design awards", "note": "Juried awards, by discipline.", "parts": [{"label": "Type", "value": 4}, {"label": "Web", "value": 3}, {"label": "Product", "value": 2}]},
]


def tab_name(stat: dict[str, Any]) -> str:
    return f"{stat['value']:,} {stat['label']}"


STAT_TABS = [tab_name(s) for s in STATS]


def proj(slug: str, title: str, client: str, category: str, year: int, hue: int, motif: str, role: str, duration: str,
         process: tuple[int, ...], standfirst: str, overview: str, objectives: list[str],
         palette: list[tuple[str, str]], screens: list[str], results: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "slug": slug, "title": title, "client": client, "category": category, "year": year, "hue": hue,
        "motif": motif, "role": role, "duration": duration, "standfirst": standfirst, "overview": overview,
        "objectives": objectives, "palette": [{"name": n, "hex": "#" + h} for n, h in palette],
        "screens": [{"caption": c} for c in screens], "process": list(process),
        "results": [{"value": v, "label": lab} for v, lab in results],
    }


PROJECTS = [
    proj("harbour-loom", "Harbour Loom", "Harbour Loom Textiles", "brand-identity", 2025, 205, "arcs",
         "Creative direction and identity design", "9 weeks", (2, 2, 3, 2),
         "A heritage weaving mill renamed and re-marked for its first range sold straight to customers.",
         "The mill had sold cloth to other brands for ninety years under a family name nobody outside the trade knew. We chose a new name, drew a mark from the path of the loom's shuttle and built a system for labels, swing tags and the shop.",
         ["Give the mill a name customers can say and remember.", "Make the mark work stitched, printed and on screen.", "Hand over a system the in-house team can run alone."],
         [("Harbour blue", "1F3A5F"), ("Undyed wool", "E9E2D0"), ("Signal coral", "D9583B")],
         ["Swing tag and woven label", "Shop front and window lettering", "Online shop header"],
         [("+64%", "return visits to the shop in the first six months"), ("11", "stockists added in the first year"), ("1", "system used across tags, signs and web")]),
    proj("northlight-gallery", "Northlight Gallery", "Northlight Gallery", "website-design", 2025, 265, "grid",
         "Website design and art direction", "12 weeks", (2, 2, 6, 2),
         "An exhibition-first website where every show gets its own page rhythm.",
         "The gallery's old site listed shows like products. The new site gives each exhibition a long page whose type, colour and image rhythm follow the work, while visiting hours and tickets stay in the same place on every page.",
         ["Let each exhibition look like itself.", "Keep visiting information one tap away on every page.", "Let the curators build a show page without a developer."],
         [("Gallery night", "1C1A2E"), ("Wall white", "F5F3EE"), ("Northlight violet", "6B5BD6")],
         ["Exhibition page opening", "Visit and tickets panel", "Archive of past shows"],
         [("+41%", "time spent on exhibition pages"), ("2 hours", "for a curator to build a show page"), ("0", "accessibility errors on the templates at launch")]),
    proj("ledgerline", "Ledgerline", "Ledgerline Ltd", "digital-product-design", 2025, 170, "grid",
         "Product design lead", "14 weeks", (3, 2, 7, 2),
         "A calmer invoicing app for freelancers, redesigned around the first five minutes.",
         "Most new users left before sending their first invoice. We rebuilt sign-up around one task, sending an invoice, moved every other setting to after it, then built a design system so the team could ship the rest.",
         ["Get a new user to their first sent invoice in five minutes.", "Cut support questions about setup.", "Give the team a design system they can extend."],
         [("Ledger teal", "1F6F6B"), ("Cloud", "F4F6F5"), ("Amber", "E0A43A")],
         ["First invoice flow", "Invoice list with paid and overdue states", "Design system components"],
         [("5 min", "median time to the first sent invoice"), ("-35%", "setup questions to support"), ("120", "components in the design system")]),
    proj("quarry-press", "Quarry Press", "Quarry Press", "brand-identity", 2024, 28, "grid",
         "Identity design and typography", "7 weeks", (1, 2, 3, 1),
         "An identity system for a small publisher of field guides, built from one condensed serif.",
         "Quarry Press publishes twelve field guides a year and every cover looked different. One condensed serif, a strict cover grid and a colour per subject now make the shelf read as one list.",
         ["Make every guide recognisable from across a shop.", "Let the designer set a new cover in a day.", "Keep the cost of colour printing flat."],
         [("Slate", "2E3338"), ("Limestone", "EDE8DC"), ("Ochre", "C8902E")],
         ["Cover grid for the field guides", "Spine system on the shelf", "Catalogue spread"],
         [("12", "covers set in the new system in its first year"), ("1 day", "to set a new cover, down from a week"), ("+22%", "bookshop orders for the spring list")]),
    proj("fieldwork-journal", "Fieldwork Journal", "Fieldwork Institute", "website-design", 2024, 50, "arcs",
         "Website design and content design", "10 weeks", (2, 1, 5, 2),
         "A long-read site for a research institute, set for comfortable reading on any screen.",
         "The institute's reports lived in PDFs few people opened. Fieldwork Journal turns each report into a readable web essay with footnotes beside the text, figures that resize cleanly and a download for the full report.",
         ["Get the reports read, not just downloaded.", "Make footnotes and figures work on a phone.", "Publish a new essay from the institute's own editor."],
         [("Ink", "22201C"), ("Paper", "F6F1E7"), ("Field yellow", "D8A520")],
         ["Essay opening with standfirst", "Footnotes beside the text", "Figure on a phone"],
         [("3x", "average reading time per essay"), ("58%", "of readers on phones finishing an essay"), ("24", "essays published in the first year")]),
    proj("pathway-transit", "Pathway", "Pathway Transit Authority", "digital-product-design", 2024, 220, "arcs",
         "Product design and usability testing", "16 weeks", (4, 2, 8, 2),
         "A journey planner that puts the next departure and step-free routes first.",
         "Riders asked one question, when does the next one leave, and the old app answered it three screens deep. Pathway opens on the nearest stops with live departures and offers step-free routes from the first screen.",
         ["Show the next departure on the first screen.", "Make step-free routes a first-class choice.", "Pass usability tests with riders who use screen readers."],
         [("Route blue", "1D4E89"), ("Platform grey", "E6E8EB"), ("Signal yellow", "F2C230")],
         ["Nearest stops with live departures", "Step-free route options", "Trip in progress"],
         [("1", "screen to the next departure, down from 3"), ("92%", "task success in tests with screen reader users"), ("+30%", "weekly riders using the app")]),
    proj("tidewater-co-op", "Tidewater Co-op", "Tidewater Grocery Co-operative", "brand-identity", 2023, 140, "stack",
         "Identity and signage design", "10 weeks", (2, 2, 4, 2),
         "A friendlier mark and signage family for a member-owned grocer with eleven stores.",
         "Members said the old signs felt like a discount warehouse. A rounded wordmark, drawn produce icons and a signage kit that store staff can print themselves changed the feel of all eleven stores in one spring.",
         ["Make the co-op feel owned by its members, not a chain.", "Give staff signs they can print and change in store.", "Keep every sign readable from the end of an aisle."],
         [("Kelp green", "2F6B4F"), ("Oat", "F2EAD8"), ("Tomato", "C8402F")],
         ["Store front at dusk", "Aisle signs and shelf labels", "Member card"],
         [("11", "stores re-signed in one spring"), ("+18%", "new members in the first year"), ("40", "sign templates staff print themselves")]),
    proj("ostler-hotels", "Ostler Hotels", "Ostler Hotel Group", "website-design", 2022, 350, "stack",
         "Website design and design system", "11 weeks", (2, 2, 5, 2),
         "A booking-led website for four small hotels that each keep their own character.",
         "Four hotels shared one template and looked identical. A shared design system with a palette and picture style per hotel lets each one look like itself, while booking works the same way everywhere.",
         ["Give each hotel its own look inside one system.", "Make booking two steps from any page.", "Cut the cost of adding a fifth hotel."],
         [("Claret", "7A1F2B"), ("Linen", "F3ECE2"), ("Brass", "B08A3E")],
         ["Hotel home page", "Room chooser", "Booking summary on a phone"],
         [("+27%", "direct bookings in the first year"), ("2", "steps from any page to a booking"), ("3 weeks", "to add a hotel to the system")]),
    proj("tally-kitchen", "Tally", "Tally Kitchen Systems", "digital-product-design", 2023, 15, "stack",
         "Product and interface design", "12 weeks", (3, 2, 5, 2),
         "An order screen for busy kitchens, readable at arm's length and usable with wet hands.",
         "Cooks read orders from two metres away while plating. Tally uses large type, colour plus shape for each course and wide touch zones, so an order can be cleared with a knuckle.",
         ["Make every order readable from two metres.", "Never rely on colour alone for course or status.", "Let a cook clear an order without precise taps."],
         [("Char", "1E1B18"), ("Steel", "DADDE0"), ("Flame", "E2572B")],
         ["Order rail at service", "Course markers in colour and shape", "Clear and recall"],
         [("2 m", "reading distance for every order"), ("-48%", "missed course changes"), ("64 px", "minimum touch zone")]),
]
SLUGS = [p["slug"] for p in PROJECTS]
BY_SLUG = {p["slug"]: p for p in PROJECTS}
SEQUENCES = {c: [p["slug"] for p in PROJECTS if p["category"] == c] for c in CATS}
DESKTOP_TABS = [
    "Skip to content", "Sollis Studio home", "About", "Services", "Work", "Philosophy", "Contact",
    "Start a project", "See selected work", "12 years of practice", "Brand Identity", "Website Design",
    "Digital Product Design", "All (9)", "Harbour Loom", "Northlight Gallery", "Ledgerline", "Quarry Press",
    "Fieldwork Journal", "Pathway", "Tidewater Co-op", "Ostler Hotels",
]
SMALL_TABS = ["Skip to content", "Sollis Studio home", "Menu", "Start a project", "See selected work"]
NOT_FOUND = {"error": "not_found", "message": "Not found."}
METHOD = {"error": "method_not_allowed", "message": "Method not allowed."}
TOO_LARGE = {"error": "too_large", "message": "The request body is too large."}
BAD_JSON = {"error": "bad_request", "message": "The request body must be JSON."}
SHAPE_ERROR = {"error": "invalid", "message": "The content does not match the published shape."}
MSG = {
    "name_empty": "Enter your name.", "name_len": "Name must be 2 to 80 characters.",
    "email_empty": "Enter your email address.", "email_bad": "Enter an email address like name@company.com.",
    "type": "Choose a project type.", "budget": "Choose a budget range.",
    "desc_empty": "Describe your project.", "desc_len": "Description must be 40 to 2,000 characters.",
    "sub": "Reload the page and try again.",
}
ERROR_HEADING = "There is a problem with your enquiry"
NOT_SAVED = "We could not send your enquiry. Please try again, or email studio@sollis.example."
ACK_LINE = "Thank you for your enquiry. Maren will reply within two working days."
DESC = "We need a calm identity for a family textile mill and its first shop."
REF_RE = re.compile(r"SOL-\d{4}")
VISITOR = "Ada Probe"
ADDED_TITLE = "Probe Addition"
RENAMED_QUARRY = "Quarry Press Renamed"
RENAMED_NORTHLIGHT = "Northlight Gallery Renewed"
RENAMED_TALLY = "Tally Renamed"
SPLIT_NOTE = "Probe split note."
KEPT_MARK = "same-document"


def ref_for(n: int) -> str:
    return f"SOL-{n:04d}"


RECORDER_JS = r"""
(() => {
  if (window.__rec) return;
  const rec = (window.__rec = []);
  const skip = ['offset', 'easing', 'composite', 'computedOffset'];
  const kebab = (p) => p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const geo = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {x: r.left, y: r.top, w: r.width, h: r.height, o: parseFloat(cs.opacity), t: cs.transform, rot: cs.rotate};
  };
  const heroOf = (el) => (el.matches('[data-hero]') ? el : el.querySelector('[data-hero]'));
  const push = (a) => {
    try {
      const e = a.effect;
      if (!e || !e.target || rec.some((r) => r.a === a)) return;
      const timing = e.getComputedTiming();
      const delay = e.getTiming().delay || 0;
      const entry = {a, el: e.target, pseudo: e.pseudoElement || null, props: [], duration: timing.duration, delay,
                     begin: null, start: null, end: null, hstart: null, hend: null};
      if (a.transitionProperty) entry.props.push(a.transitionProperty);
      for (const k of e.getKeyframes()) for (const p of Object.keys(k))
        if (!skip.includes(p) && !entry.props.includes(kebab(p))) entry.props.push(kebab(p));
      rec.push(entry);
      a.ready.then(() => { if (a.startTime !== null) entry.begin = a.startTime + delay; }).catch(() => {});
      if (entry.pseudo || !isFinite(timing.duration) || timing.duration <= 0) return;
      const was = a.currentTime === null ? 0 : a.currentTime;
      const hero = heroOf(e.target);
      a.currentTime = delay;
      entry.start = geo(e.target); entry.hstart = hero ? geo(hero) : null;
      a.currentTime = delay + timing.duration - 0.5;
      entry.end = geo(e.target); entry.hend = hero ? geo(hero) : null;
      a.currentTime = was;
    } catch (_) {}
  };
  const scan = (el) => { if (el && el.getAnimations) el.getAnimations().forEach(push); };
  document.addEventListener('transitionrun', (ev) => scan(ev.target), true);
  document.addEventListener('animationstart', (ev) => scan(ev.target), true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); push(a); return a; };
})();
"""

RECS_JS = r"""
(root) => (window.__rec || []).map((r) => {
  let rel = 'other';
  if (root) {
    if (r.el === root) rel = 'self';
    else if (root.contains(r.el)) rel = 'inside';
    else if (r.el.contains(root) && r.el !== document.documentElement && r.el !== document.body) rel = 'ancestor';
  }
  const hero = !!(r.el.matches && (r.el.matches('[data-hero]') || r.el.querySelector('[data-hero]')))
    && r.el !== document.documentElement && r.el !== document.body;
  return {rel, hero, props: r.props, duration: isFinite(r.duration) ? r.duration : -1, delay: r.delay,
          begin: r.begin, start: r.start, end: r.end, hstart: r.hstart, hend: r.hend, pseudo: r.pseudo};
}).filter((r) => !root || r.rel !== 'other')
"""

RECT_JS = "el => { const r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right}; }"
DOC_TOP_JS = "el => el.getBoundingClientRect().top + window.scrollY"
DOC_BEFORE_JS = "([a, b]) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)"
SCROLL_JS = "y => window.scrollTo({top: y, left: 0, behavior: 'instant'})"
IO_JS = """([el, m]) => new Promise((res) => {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); res(true); } },
                                      {rootMargin: `0px 0px -${m}% 0px`});
  io.observe(el);
})"""
CURRENT_JS = "() => Array.from(document.links).filter(a => a.getAttribute('aria-current') === 'true').map(a => a.textContent.trim())"
POINT_JS = """(ids) => { const y = innerHeight * 0.4;
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect();
    if (r.top <= y && r.bottom > y) return id; } return null; }"""
STATUS_WATCH_JS = """el => { window.__ann = []; new MutationObserver(() => window.__ann.push(el.textContent.trim()))
  .observe(el, {childList: true, subtree: true, characterData: true}); }"""
UNION_JS = """el => { const rs = [el.getBoundingClientRect(), ...Array.from(el.labels || []).map(l => l.getBoundingClientRect())]
  .filter(r => r.width > 0 && r.height > 0);
  if (!rs.length) return null;
  const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
  const rr = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
  return {x: l, y: t, w: rr - l, h: b - t, b: b}; }"""
FOCUS_JS = """([el, banner]) => {
  const rgba = (s) => (s.match(/[\\d.]+/g) || ['0', '0', '0', '0']).map(Number);
  const ring = (n) => { const cs = getComputedStyle(n); return {w: parseFloat(cs.outlineWidth) || 0, s: cs.outlineStyle, c: rgba(cs.outlineColor), n}; };
  const cands = [el, ...Array.from(el.labels || []), el.parentElement].filter(Boolean);
  let best = ring(el);
  for (const n of cands) { const r = ring(n); if (r.s !== 'none' && r.w >= best.w) best = r; }
  let bg = [255, 255, 255];
  for (let n = best.n; n && n.nodeType === 1; n = n.parentElement) {
    const c = rgba(getComputedStyle(n).backgroundColor);
    if (c.length < 4 || c[3] > 0) { bg = c; break; }
  }
  const rs = [el.getBoundingClientRect(), ...Array.from(el.labels || []).map(l => l.getBoundingClientRect())].filter(r => r.width > 0 && r.height > 0);
  const top = rs.length ? Math.min(...rs.map(r => r.top)) : 0, bottom = rs.length ? Math.max(...rs.map(r => r.bottom)) : 0;
  return {name: (el.getAttribute('aria-label') || el.textContent || '').trim(), ow: best.w, os: best.s, oc: best.c, bg,
          top, bottom, vh: innerHeight, banner: banner.contains(el), sized: rs.length > 0};
}"""
TEXT_WITH_BREAKS_JS = """els => els.map(el => { const c = el.cloneNode(true);
  c.querySelectorAll('br').forEach(b => b.replaceWith('\\n')); return c.textContent; })"""
MAX_WIDTH_JS = "el => Math.max(...[el, ...el.querySelectorAll('*')].map(n => n.getBoundingClientRect().width))"


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def in_order(haystack: str, needles: list[str], what: str) -> None:
    pos, hay = 0, norm(haystack)
    for n in needles:
        i = hay.find(norm(n), pos)
        assert i >= 0, f"{what}: expected {n!r} in published order after offset {pos}"
        pos = i + len(norm(n))


def grading(method: str, base: str, path: str = "/api/grading/content", key: str | None = None, **kw: Any) -> httpx.Response:
    headers = dict(kw.pop("headers", {}))
    headers.setdefault("X-Grading-Key", KEY if key is None else key)
    return httpx.request(method, base + path, headers=headers, timeout=HTTP_S, **kw)


def restore(base: str) -> None:
    r = grading("DELETE", base)
    assert r.status_code == 200 and r.json() == {"edition": 1}, f"DELETE /api/grading/content: {r.status_code} {r.text}"


def seed_body() -> dict[str, Any]:
    return {"projects": copy.deepcopy(PROJECTS), "stats": copy.deepcopy(STATS)}


def put_content(base: str, body: dict[str, Any]) -> int:
    r = grading("PUT", base, json=body)
    assert r.status_code == 200, f"PUT /api/grading/content accepted the published shape: {r.status_code} {r.text}"
    return int(r.json()["edition"])


def enquiries(base: str) -> list[dict[str, Any]]:
    r = grading("GET", base, "/api/grading/enquiries")
    assert r.status_code == 200, r.text
    return r.json()["enquiries"]


def stored_for(base: str, email: str) -> list[dict[str, Any]]:
    return [e for e in enquiries(base) if e.get("email") == email]


def new_email(prefix: str) -> str:
    a, b = unique(prefix)
    return (a if "@" in a else b).lower()


def enquiry(email: str, **over: Any) -> dict[str, Any]:
    body = {"submission_id": str(uuid.uuid4()), "name": "Ada Probe", "email": email,
            "project_type": "brand-identity", "budget": "10k-25k", "description": DESC}
    body.update(over)
    return body


def post_enquiry(base: str, body: Any) -> httpx.Response:
    return httpx.post(base + "/api/enquiries", json=body, timeout=HTTP_S)


def mail_for(mail: Mailpit, email: str, expected: int) -> list[dict[str, Any]]:
    deadline = time.monotonic() + MAIL_S
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(expected=0, settle=0.3)
                 if email in addresses(m.get("To")) + addresses(m.get("ReplyTo"))]
        if len(found) >= expected:
            break
    if len(found) < expected:
        pytest.fail(f"Mailpit received {len(found)} of {expected} messages for {email}")
    return [m for m in mail.messages(expected=0, settle=1.5)
            if email in addresses(m.get("To")) + addresses(m.get("ReplyTo"))]


def mail_time(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return parsedate_to_datetime(value)


def mail_absent(mail: Mailpit, email: str) -> None:
    got = [m for m in mail.messages(expected=0, settle=ABSENT_S)
           if email in addresses(m.get("To")) + addresses(m.get("ReplyTo"))]
    assert got == [], f"no message may reach Mailpit for {email}; got {len(got)}"


@contextmanager
def visit(browser: Browser, url: str, size: tuple[int, int] = DESKTOP, reduced: bool = False,
          record: bool = False) -> Iterator[Page]:
    u = urlparse(url)
    base = f"{u.scheme}://{u.netloc}"
    with open_app(browser, base + "/privacy", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if record:
            page.add_init_script(script=RECORDER_JS)
        page.goto(url)
        if urlparse(url).fragment:
            advance(page, FRAME_MS * 2)
        yield page


def poll(page: Page | None, fn: Callable[[], Any], what: str, seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            last = fn()
        except Exception as exc:
            last = exc
        if last is True:
            return
        if page is not None:
            advance(page, STEP_MS)
    pytest.fail(f"expected: {what} (last observation {last!r})")


def reach(page: Page, fn: Callable[[], tuple[bool, Any]], budget_ms: float, what: str) -> None:
    spent, prev = 0.0, None
    deadline = time.monotonic() + budget_ms / 1000 + SLACK_S
    while time.monotonic() < deadline:
        ok, marker = fn()
        if ok and prev == marker:
            return
        prev = marker if ok else None
        step = min(STEP_MS, budget_ms - spent)
        if step > 0:
            advance(page, step)
            spent += step
    pytest.fail(f"expected within {budget_ms} ms of page time: {what}")


def box(loc: Locator) -> dict[str, float]:
    return loc.evaluate(RECT_JS)


def doc_top(loc: Locator) -> float:
    return float(loc.evaluate(DOC_TOP_JS))


def scroll_to(page: Page, y: float) -> None:
    page.evaluate(SCROLL_JS, max(0, round(y)))


def before(a: Locator, b: Locator) -> bool:
    return bool(a.page.evaluate(DOC_BEFORE_JS, [a.element_handle(), b.element_handle()]))


def target(link: Locator) -> str:
    u = urlparse(link.evaluate("a => a.href"))
    return u.path + (f"?{u.query}" if u.query else "") + (f"#{u[5]}" if u[5] else "")


def params(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def hash_of(page: Page) -> str:
    return urlparse(page.url)[5]


def history_len(page: Page) -> int:
    return int(page.evaluate("history.length"))


def region(page: Page, sid: str) -> Locator:
    return page.get_by_role("region", name=REGION_NAMES[sid], exact=True)


def h2(page: Page, sid: str) -> Locator:
    return region(page, sid).get_by_role("heading", level=2, name=REGION_NAMES[sid], exact=True)


def h1(page: Page) -> Locator:
    return page.get_by_role("heading", level=1)


def banner_bottom(page: Page) -> float:
    return box(page.get_by_role("banner"))["b"]


def assert_jump(page: Page, heading: Locator, budget_ms: float, what: str) -> None:
    def probe() -> tuple[bool, Any]:
        hb = banner_bottom(page)
        st = heading.evaluate("el => ({f: document.activeElement === el, top: el.getBoundingClientRect().top, vh: innerHeight, y: scrollY})")
        ok = st["f"] and st["top"] >= hb + CLEAR_PX - 0.5 and st["top"] < st["vh"]
        return ok, (round(st["y"]), round(st["top"]))
    reach(page, probe, budget_ms, f"{what}: heading focused at least {CLEAR_PX} px below the header")


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Site updates")


def watch_status(page: Page) -> None:
    status(page).evaluate(STATUS_WATCH_JS)


def announcements(page: Page) -> list[str]:
    return [t for t in page.evaluate("() => window.__ann || []") if t]


def assert_announced(page: Page, expected: str, what: str) -> None:
    poll(page, lambda: len(announcements(page)) >= 1, f"{what}: announcement {expected!r}")
    advance(page, SETTLE_MS)
    got = announcements(page)
    assert got == [expected], f"{what}: expected one announcement {expected!r}, got {got}"
    page.evaluate("() => { window.__ann.length = 0; }")


def recs(page: Page, loc: Locator | None = None) -> list[dict[str, Any]]:
    return page.evaluate(RECS_JS, loc.element_handle() if loc is not None else None)


def clear_recs(page: Page) -> None:
    page.evaluate("() => { if (window.__rec) window.__rec.length = 0; }")


def timed(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in entries if e["duration"] > ATONCE_MS]


def in_range(v: float, rng: tuple[float, float]) -> bool:
    return rng[0] <= v <= rng[1]


def rise(e: dict[str, Any]) -> float:
    return e["start"]["y"] - e["end"]["y"] if e.get("start") and e.get("end") else 0.0


def filter_group(page: Page) -> Locator:
    return page.get_by_role("radiogroup", name="Filter work by service")


def radio_name(cat: str | None, n: int) -> str:
    return f"{CATS[cat] if cat else 'All'} ({n})"


def shown_slugs(page: Page) -> list[str]:
    return page.locator("[data-project]").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0 && !e.closest('[hidden]')).map(e => e.dataset.project)")


def item(page: Page, slug: str) -> Locator:
    return page.locator(f'[data-project="{slug}"]')


def service_button(page: Page, sid: str) -> Locator:
    return page.get_by_role("button", name=CATS[sid], exact=True)


def form(page: Page) -> Locator:
    return page.get_by_role("form", name="Project enquiry")


def field(page: Page, name: str) -> Locator:
    return form(page).get_by_role("textbox", name=name, exact=True)


def type_radio(page: Page, tid: str) -> Locator:
    return form(page).get_by_role("radiogroup", name="Project type").get_by_role("radio", name=TYPES[tid], exact=True)


CHOOSE_JS = """e => { const t = (e.labels && e.labels.length) ? e.labels[0] : e;
  t.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {x, y, ok: !!hit && (hit === e || t.contains(hit) || e.contains(hit))}; }"""


def choose(radio: Locator, by_touch: bool = False) -> None:
    if radio.is_checked():
        return
    at = radio.evaluate(CHOOSE_JS)
    assert at["ok"], "the radio's label is obscured at its centre"
    (radio.page.touchscreen.tap if by_touch else radio.page.mouse.click)(at["x"], at["y"])
    expect(radio).to_be_checked()


def send_button(page: Page) -> Locator:
    return form(page).get_by_role("button", name="Send enquiry", exact=True)


def fill_enquiry(page: Page, name: str, email: str, tid: str, bid: str, desc: str) -> None:
    fill(field(page, "Name"), name)
    fill(field(page, "Email"), email)
    choose(type_radio(page, tid))
    select(form(page).get_by_role("combobox", name="Budget range"), BUDGETS[bid])
    fill(field(page, "Project description"), desc)


def await_panel(page: Page, first: str) -> str:
    heading = page.get_by_role("heading", level=3, name=f"Thank you, {first}.", exact=True)
    poll(page, lambda: heading.count() == 1, f"thank-you heading 'Thank you, {first}.'", seconds=MAIL_S)
    expect(heading).to_be_focused()
    txt = norm(region(page, "contact").text_content())
    m = re.search(r"Your enquiry (SOL-\d{4}) is with Maren\. She will reply within two working days\.", txt)
    assert m, f"thank-you line with the reference, got {txt[:300]!r}"
    return m.group(1)


def focused_name(page: Page) -> str:
    if page.evaluate("() => !document.activeElement || document.activeElement === document.body"):
        return ""
    line = page.locator(":focus").first.aria_snapshot().splitlines()[0].strip()
    line = line[2:] if line.startswith("- ") else line
    if line.startswith("'"):
        quoted = re.match(r"'((?:[^']|'')*)'", line)
        line = quoted.group(1).replace("''", "'") if quoted else line
    named = re.match(r'[\w-]+ "((?:[^"\\]|\\.)*)"', line)
    return json.loads(f'"{named.group(1)}"') if named else ""


def tab_names(page: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(focused_name(page))
    return names


def panel_pairs(page: Page) -> dict[str, str]:
    contact = region(page, "contact")
    terms = [norm(t) for t in contact.get_by_role("term").all_text_contents()]
    defs = [d.replace("\r\n", "\n").strip() for d in contact.get_by_role("definition").evaluate_all(TEXT_WITH_BREAKS_JS)]
    assert "Reference" in terms and len(terms) == len(defs), f"description list Your enquiry, got terms {terms}"
    i = terms.index("Reference")
    return dict(zip(terms[i:i + 6], defs[i:i + 6]))


def lum(c: list[float]) -> float:
    def ch(v: float) -> float:
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a: list[float], b: list[float]) -> float:
    hi, lo = sorted([lum(a), lum(b)], reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def angle(g: dict[str, Any]) -> float:
    a = 0.0
    m = re.match(r"matrix(3d)?\(([^)]+)\)", g.get("t") or "")
    if m:
        v = [float(x) for x in m.group(2).split(",")]
        a = math.degrees(math.atan2(v[1], v[0]))
    r = re.search(r"(-?[\d.]+)deg", g.get("rot") or "")
    if r:
        a += float(r.group(1))
    return a


def translate_y(st: dict[str, str]) -> float:
    ty = 0.0
    m = re.match(r"matrix(3d)?\(([^)]+)\)", st.get("transform") or "")
    if m:
        v = [float(x) for x in m.group(2).split(",")]
        ty += v[13] if m.group(1) else v[5]
    tr = (st.get("translate") or "none").split()
    if len(tr) > 1:
        ty += float(tr[1].replace("px", ""))
    return ty


def plate_y(page: Page) -> float:
    return translate_y(style(page.locator("[data-parallax]"), "transform", "translate"))


def count_texts(page: Page) -> list[str]:
    return [t.strip() for t in page.locator("[data-count]").all_text_contents()]


def curve(value: int, t: float) -> int:
    x = min(max(t / COUNT_MS, 0.0), 1.0)
    return math.floor(value * (1 - (1 - x) ** 3) + 0.5)


def start_count(page: Page) -> Locator:
    tablist = page.get_by_role("tablist", name="Statistics")
    vh = page.evaluate("innerHeight")
    scroll_to(page, doc_top(tablist) - vh * 0.5)
    page.evaluate(IO_JS, [tablist.element_handle(), round((1 - COUNT_EDGE) * 100)])
    return tablist


def distinct(values: list[float], tol: float = ROW_TOL_PX) -> int:
    out: list[float] = []
    for v in sorted(values):
        if not out or abs(v - out[-1]) > tol:
            out.append(v)
    return len(out)


def touch(page: Page) -> Any:
    s = session(page)
    s.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return s


_SWIPE_END: dict[int, float] = {}


def swipe(s: Any, x0: float, y: float, dx: float) -> None:
    while time.time() < _SWIPE_END.get(id(s), 0.0):
        pass
    start = time.time()
    s.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}], "timestamp": start})
    for i in range(1, SWIPE_STEPS + 1):
        s.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + dx * i / SWIPE_STEPS, "y": y}],
                                            "timestamp": start + i * SWIPE_STEP_MS / 1000})
    end = start + (SWIPE_STEPS + 1) * SWIPE_STEP_MS / 1000
    s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [], "timestamp": end})
    _SWIPE_END[id(s)] = end


def touch_tap(s: Any, x: float, y: float) -> None:
    s.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def open_case_from_gallery(page: Page, slug: str) -> None:
    it = item(page, slug)
    scroll_to(page, doc_top(it) - HEADER_PX * 2)
    click(it.get_by_role("link", name=BY_SLUG[slug]["title"], exact=True))
    poll(page, lambda: urlparse(page.url).path == f"/work/{slug}", f"address /work/{slug}")


def assert_case_arrival(page: Page, slug: str) -> None:
    title = BY_SLUG[slug]["title"]
    poll(page, lambda: page.title() == f"{title} | Sollis Studio", f"title of {slug}")
    poll(page, lambda: h1(page).evaluate("el => document.activeElement === el && el.textContent.trim().length > 0"),
         f"focus on the level-1 heading of {slug}")
    expect(h1(page)).to_have_accessible_name(title)


def test_home_seed_content(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        expect(page).to_have_title(TITLE_HOME)
        regions = [region(page, sid) for sid in SECTION_IDS]
        for sid, reg in zip(SECTION_IDS, regions):
            expect(reg).to_have_count(1)
            expect(reg).to_have_attribute("id", sid)
            if sid != "intro":
                expect(h2(page, sid)).to_have_count(1)
        for a, b in zip(regions, regions[1:]):
            assert before(a, b), "sections of / in published order"
        assert before(regions[-1], page.get_by_role("contentinfo"))
        expect(h1(page)).to_have_count(1)
        expect(h1(page)).to_have_accessible_name(H1_NAME)
        for i, line in enumerate(INTRO_LINES, 1):
            expect(page.locator(f'[data-line="{i}"]')).to_have_text(line)
        expect(region(page, "intro").get_by_text(INTRO_TEXT, exact=True)).to_have_count(1)
        about = region(page, "about")
        in_order(about.text_content() or "", ["About Maren", ABOUT_P1, ABOUT_P2, "Background", *BACKGROUND], "About")
        expect(about.get_by_role("heading", level=3, name="Background", exact=True)).to_have_count(1)
        expect(about.get_by_role("list").filter(has_text=BACKGROUND[0]).get_by_role("listitem")).to_have_text(BACKGROUND)
        expect(about.get_by_role("img", name="Portrait of Maren Sollis, drawn", exact=True)).to_have_count(1)
        tabs = about.get_by_role("tablist", name="Statistics").get_by_role("tab")
        expect(tabs).to_have_count(len(STAT_TABS))
        for i, name in enumerate(STAT_TABS):
            expect(tabs.nth(i)).to_have_accessible_name(name)
        services = region(page, "services")
        in_order(services.text_content() or "", ["Services", SERVICES_LINE], "Services")
        for i, sid in enumerate(CATS):
            expect(services.get_by_role("heading", level=3).nth(i).get_by_role("button")).to_have_accessible_name(CATS[sid])
        radios = filter_group(page).get_by_role("radio")
        expect(radios).to_have_count(4)
        for i, name in enumerate(["All (9)", "Brand Identity (3)", "Website Design (3)", "Digital Product Design (3)"]):
            expect(radios.nth(i)).to_have_accessible_name(name)
        assert shown_slugs(page) == SLUGS
        phil = region(page, "philosophy")
        expect(phil.get_by_role("heading", level=3, name="Principles", exact=True)).to_have_count(1)
        expect(phil.get_by_role("heading", level=3, name="Process", exact=True)).to_have_count(1)
        plist = phil.get_by_role("list").filter(has_text=PRINCIPLES[0][0])
        expect(plist.get_by_role("listitem")).to_have_count(3)
        expect(plist.get_by_role("heading", level=4)).to_have_text([p[0] for p in PRINCIPLES])
        in_order(phil.text_content() or "", ["How I work", "Principles", *[x for p in PRINCIPLES for x in p], "Process"], "Philosophy")
        ptabs = phil.get_by_role("tablist", name="Process").get_by_role("tab")
        expect(ptabs).to_have_text([s[0] for s in PROCESS_STEPS])
        contact = region(page, "contact")
        in_order(contact.text_content() or "", ["Start a project", CONTACT_LINE, "Email", STUDIO_EMAIL, "Phone", PHONE_NAME, "Studio", "London, working worldwide"], "Contact")
        expect(contact.get_by_role("link", name=STUDIO_EMAIL, exact=True)).to_have_attribute("href", f"mailto:{STUDIO_EMAIL}")
        expect(contact.get_by_role("link", name=PHONE_NAME, exact=True)).to_have_attribute("href", PHONE_HREF)
        foot = page.get_by_role("contentinfo")
        in_order(foot.text_content() or "", FOOTER_TEXTS[:2], "footer texts")
        expect(foot.get_by_text(FOOTER_TEXTS[2], exact=True)).to_have_count(1)
        fnav = foot.get_by_role("navigation", name="Footer")
        for name, href in FOOTER_LINKS:
            assert target(fnav.get_by_role("link", name=name, exact=True)) == href
        social = foot.get_by_role("navigation", name="Social")
        for name, href in SOCIAL_LINKS:
            link = social.get_by_role("link", name=name, exact=True)
            expect(link).to_have_attribute("href", href)
            expect(link).to_have_attribute("target", "_blank")
            rel = (link.get_attribute("rel") or "").split()
            assert "noopener" in rel and "noreferrer" in rel
        expect(foot.get_by_role("link", name=STUDIO_EMAIL, exact=True)).to_have_attribute("href", f"mailto:{STUDIO_EMAIL}")


def test_section_jumps_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        nav = page.get_by_role("navigation", name="Main")
        for name, sid in NAV_LINKS.items():
            scroll_to(page, 0)
            click(nav.get_by_role("link", name=name, exact=True))
            assert_jump(page, h2(page, sid), JUMP_MS, f"Main link {name}")
        scroll_to(page, 0)
        click(page.get_by_role("navigation", name="Footer").get_by_role("link", name="Services", exact=True))
        assert_jump(page, h2(page, "services"), JUMP_MS, "Footer link Services")
    with visit(browser, app_url + "/", reduced=True) as page:
        nav = page.get_by_role("navigation", name="Main")
        for name, sid in NAV_LINKS.items():
            scroll_to(page, 0)
            click(nav.get_by_role("link", name=name, exact=True))
            assert_jump(page, h2(page, sid), FRAME_MS, f"reduced-motion Main link {name}")
    for sid in ["about", "work", "contact"]:
        with visit(browser, app_url + f"/#{sid}") as page:
            assert_jump(page, h2(page, sid), FRAME_MS, f"load of /#{sid}")


def test_current_section_while_scrolling(browser: Browser, app_url: str) -> None:
    restore(app_url)
    names = {v: k for k, v in NAV_LINKS.items()}
    with visit(browser, app_url + "/", reduced=True) as page:
        vh = page.evaluate("innerHeight")
        seen: set[str] = set()
        order = SECTION_IDS[1:] + list(reversed(SECTION_IDS[1:-1]))
        for sid in order:
            scroll_to(page, doc_top(region(page, sid)) + 10 - vh * POINT)
            expected = page.evaluate(POINT_JS, SECTION_IDS)
            want = [names[expected]] if expected in names else []
            if expected:
                seen.add(expected)
            poll(page, lambda w=want: page.evaluate(CURRENT_JS) == w, f"aria-current exactly on {want} at section {sid}")
        assert {"about", "services", "work", "philosophy"} <= seen
        scroll_to(page, 0)
        poll(page, lambda: page.evaluate(CURRENT_JS) == [], "no current link while the intro holds the point")
    with visit(browser, app_url + "/", size=TABLET, reduced=True) as page:
        vh = page.evaluate("innerHeight")
        scroll_to(page, doc_top(region(page, "services")) + 10 - vh * POINT)
        advance(page, SETTLE_MS)
        click(page.get_by_role("button", name="Menu", exact=True))
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.get_by_role("link", name="Services", exact=True).get_attribute("aria-current") == "true",
             "menu link Services current")
        others = [n for n in NAV_LINKS if n != "Services"]
        for n in others:
            assert dialog.get_by_role("link", name=n, exact=True).get_attribute("aria-current") != "true"


def test_statistics_count(browser: Browser, app_url: str) -> None:
    restore(app_url)
    values = [s["value"] for s in STATS]
    with visit(browser, app_url + "/") as page:
        start_count(page)
        elapsed = 0
        for t in COUNT_CHECKS:
            advance(page, t - elapsed)
            elapsed = t
            got = count_texts(page)
            assert len(got) == len(values), f"one data-count number per statistic, got {got}"
            for v, s in zip(values, got):
                assert re.fullmatch(r"\d{1,3}(,\d{3})*", s), f"whole-number format, got {s!r}"
                lo, hi = curve(v, t - 2 * FRAME_MS), curve(v, t + 2 * FRAME_MS)
                assert lo <= int(s.replace(",", "")) <= hi, f"value {v} at {t} ms reads {s}, expected {lo}..{hi}"
            for name in STAT_TABS:
                expect(page.get_by_role("tab", name=name, exact=True)).to_have_count(1)
        advance(page, 2 * FRAME_MS)
        assert count_texts(page) == [str(v) for v in values]
        scroll_to(page, 0)
        advance(page, SETTLE_MS)
        start_count(page)
        advance(page, COUNT_CHECKS[0])
        assert count_texts(page) == [str(v) for v in values], "the count runs once per page load"
    with visit(browser, app_url + "/", reduced=True) as page:
        start_count(page)
        advance(page, FRAME_MS)
        assert count_texts(page) == [str(v) for v in values], "reduced motion shows the values at once"
    body = seed_body()
    body["stats"][1] = {"id": "projects", "value": BIG_VALUE, "label": "projects delivered", "note": STATS[1]["note"],
                        "parts": [{"label": "Studio", "value": BIG_PARTS[0]}, {"label": "Solo", "value": BIG_PARTS[1]}]}
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/") as page:
            expect(page.get_by_role("tab", name="12,345 projects delivered", exact=True)).to_have_count(1)
            start_count(page)
            advance(page, COUNT_CHECKS[1])
            mid = count_texts(page)[1]
            assert re.fullmatch(r"\d{1,3}(,\d{3})*", mid), f"thousands separator while counting, got {mid!r}"
            lo, hi = curve(BIG_VALUE, COUNT_CHECKS[1] - 2 * FRAME_MS), curve(BIG_VALUE, COUNT_CHECKS[1] + 2 * FRAME_MS)
            assert lo <= int(mid.replace(",", "")) <= hi
            advance(page, COUNT_MS)
            assert count_texts(page)[1] == "12,345"
    finally:
        restore(app_url)


def test_statistics_tabs_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        watch_status(page)
        tl = page.get_by_role("tablist", name="Statistics")
        tab = lambda i: tl.get_by_role("tab", name=STAT_TABS[i], exact=True)
        expect(tab(0)).to_have_attribute("aria-selected", "true")
        page.get_by_role("link", name="See selected work", exact=True).focus()
        page.keyboard.press("Tab")
        expect(tab(0)).to_be_focused()
        for key, idx in [("ArrowRight", 1), ("ArrowRight", 2), ("ArrowRight", 3), ("ArrowRight", 0), ("ArrowLeft", 3),
                         ("Home", 0), ("End", 3), ("ArrowLeft", 2)]:
            page.keyboard.press(key)
            expect(tab(idx)).to_be_focused()
            expect(tab(idx)).to_have_attribute("aria-selected", "true")
            for j in range(len(STAT_TABS)):
                if j != idx:
                    expect(tab(j)).not_to_have_attribute("aria-selected", "true")
            expect(region(page, "about").get_by_role("tabpanel")).to_contain_text(STATS[idx]["note"])
        page.keyboard.press("Tab")
        expect(service_button(page, "brand-identity")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(tab(2)).to_be_focused()
        page.get_by_role("link", name="See selected work", exact=True).focus()
        page.keyboard.press("Tab")
        expect(tab(2)).to_be_focused()
        advance(page, SETTLE_MS)
        assert announcements(page) == [], "choosing a statistic announces nothing"


def bar_shares(panel: Locator, labels: list[str]) -> list[float]:
    segs = panel.locator("[data-part]")
    expect(segs).to_have_count(len(labels))
    got = segs.evaluate_all("els => els.map(e => e.dataset.part)")
    assert got == labels, f"segments in part order, got {got}"
    rects = segs.evaluate_all("els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })")
    same_row = distinct([r[1] for r in rects]) == 1
    sizes = [r[2] if same_row else r[3] for r in rects]
    total = sum(sizes)
    assert total > 0
    return [100 * s / total for s in sizes]


def test_statistic_part_bars(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        about = region(page, "about")
        for i, stat in enumerate(STATS):
            click(about.get_by_role("tab", name=STAT_TABS[i], exact=True))
            panel = about.get_by_role("tabpanel")
            expect(panel).to_contain_text(stat["note"])
            shares = bar_shares(panel, [p["label"] for p in stat["parts"]])
            for share, part in zip(shares, stat["parts"]):
                want = 100 * part["value"] / stat["value"]
                assert abs(share - want) <= SHARE_TOL_PP, f"{part['label']} share {share:.2f}% vs {want:.2f}%"
                expect(panel.get_by_text(f"{part['label']}: {part['value']:,}", exact=True)).to_have_count(1)
    body = seed_body()
    body["stats"][0] = {"id": "years", "value": sum(BAR_PARTS), "label": "years of practice", "note": SPLIT_NOTE,
                        "parts": [{"label": "Alpha", "value": BAR_PARTS[0]}, {"label": "Beta", "value": BAR_PARTS[1]}]}
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/", reduced=True) as page:
            panel = region(page, "about").get_by_role("tabpanel")
            expect(panel).to_contain_text(SPLIT_NOTE)
            shares = bar_shares(panel, ["Alpha", "Beta"])
            for share, v in zip(shares, BAR_PARTS):
                assert abs(share - 100 * v / sum(BAR_PARTS)) <= SHARE_TOL_PP
            expect(panel.get_by_text(f"Alpha: {BAR_PARTS[0]}", exact=True)).to_have_count(1)
    finally:
        restore(app_url)


def test_services_collapsed_at_load(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        for sid, name in CATS.items():
            expect(service_button(page, sid)).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("link", name=f"See {name} work", exact=True)).to_have_count(0)
            expect(page.get_by_role("link", name=f"Start a {name} project", exact=True)).to_have_count(0)
            for cap in SERVICES[sid]["caps"] + SERVICES[sid]["dels"]:
                expect(page.get_by_role("listitem").filter(has_text=re.compile(f"^{re.escape(cap)}$"))).to_have_count(0)
        service_button(page, "brand-identity").focus()
        assert tab_names(page, 3) == ["Website Design", "Digital Product Design", "All (9)"]
    with visit(browser, app_url + "/?service=no-such-service") as page:
        for sid in CATS:
            expect(service_button(page, sid)).to_have_attribute("aria-expanded", "false")


def test_service_panel_content(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        services = region(page, "services")
        for sid, name in CATS.items():
            click(service_button(page, sid))
            expect(service_button(page, sid)).to_have_attribute("aria-expanded", "true")
            s = SERVICES[sid]
            in_order(services.text_content() or "", [s["summary"], "Capabilities", *s["caps"], "Deliverables", *s["dels"],
                                                     f"Typical engagement: {s['weeks']}", f"See {name} work", f"Start a {name} project"], name)
            for li in s["caps"] + s["dels"]:
                expect(services.get_by_role("listitem").filter(has_text=re.compile(f"^{re.escape(li)}$"))).to_have_count(1)
            expect(services.get_by_role("heading", level=4, name="Capabilities", exact=True)).to_have_count(1)
            expect(services.get_by_role("heading", level=4, name="Deliverables", exact=True)).to_have_count(1)
            expect(services.get_by_text(f"Typical engagement: {s['weeks']}", exact=True)).to_have_count(1)
            assert target(services.get_by_role("link", name=f"See {name} work", exact=True)) == f"/?category={sid}#work"
            assert target(services.get_by_role("link", name=f"Start a {name} project", exact=True)) == f"/?type={sid}#contact"
        for size, side in [(DESKTOP, True), (TABLET, True), (PHONE, False)]:
            page.set_viewport_size({"width": size[0], "height": size[1]})
            cap = box(services.get_by_role("heading", level=4, name="Capabilities", exact=True))
            dl = box(services.get_by_role("heading", level=4, name="Deliverables", exact=True))
            if side:
                assert dl["x"] >= cap["r"] - 1 and abs(dl["y"] - cap["y"]) < cap["h"], f"lists side by side at {size}"
            else:
                assert dl["y"] >= cap["b"], f"lists stacked at {size}"


def test_service_panel_motion(browser: Browser, app_url: str) -> None:
    restore(app_url)
    height_props = {"height", "max-height", "grid-template-rows", "block-size", "max-block-size"}
    with visit(browser, app_url + "/", record=True) as page:
        services = region(page, "services")
        btn = service_button(page, "website-design")
        for expanded in ("true", "false"):
            clear_recs(page)
            click(btn)
            expect(btn).to_have_attribute("aria-expanded", expanded)
            def ready() -> bool:
                es = timed(recs(page, services))
                return any(height_props & set(e["props"]) for e in es) and any(e["rel"] in ("self", "inside") for e in timed(recs(page, btn)))
            poll(page, ready, f"height and chevron animations (aria-expanded={expanded})")
            hs = [e for e in timed(recs(page, services)) if height_props & set(e["props"])]
            assert any(in_range(e["duration"], PANEL_MS) for e in hs), f"panel height over {PANEL_MS} ms, got {[e['duration'] for e in hs]}"
            chev = [e for e in timed(recs(page, btn)) if e["start"] and e["end"] and in_range(e["duration"], PANEL_MS)]
            turns = [abs((angle(e["end"]) - angle(e["start"]) + 180) % 360 - 180) for e in chev]
            assert any(t >= 180 - GEOM_TOL_PX for t in turns), f"chevron turns half a turn, got {turns}"
            settle(services)
    with visit(browser, app_url + "/", reduced=True, record=True) as page:
        services = region(page, "services")
        clear_recs(page)
        click(service_button(page, "website-design"))
        expect(service_button(page, "website-design")).to_have_attribute("aria-expanded", "true")
        expect(services.get_by_role("heading", level=4, name="Capabilities", exact=True)).to_be_visible()
        advance(page, FRAME_MS)
        assert timed(recs(page, services)) == [], "reduced motion opens the panel at once"


def test_service_buttons_arrow_keys(browser: Browser, app_url: str) -> None:
    restore(app_url)
    ids = list(CATS)
    with visit(browser, app_url + "/", reduced=True) as page:
        click(service_button(page, "website-design"))
        expect(service_button(page, "website-design")).to_have_attribute("aria-expanded", "true")
        service_button(page, "brand-identity").focus()
        for key, idx in [("ArrowDown", 1), ("ArrowDown", 2), ("ArrowDown", 0), ("ArrowUp", 2), ("Home", 0), ("End", 2), ("ArrowUp", 1)]:
            page.keyboard.press(key)
            expect(service_button(page, ids[idx])).to_be_focused()
            for sid in ids:
                expect(service_button(page, sid)).to_have_attribute("aria-expanded", "true" if sid == "website-design" else "false")


def test_one_open_service_in_address(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/?category=brand-identity#services", reduced=True) as page:
        hist = history_len(page)
        click(service_button(page, "brand-identity"))
        poll(page, lambda: params(page).get("service") == ["brand-identity"], "service=brand-identity")
        click(service_button(page, "website-design"))
        expect(service_button(page, "brand-identity")).to_have_attribute("aria-expanded", "false")
        expect(service_button(page, "website-design")).to_have_attribute("aria-expanded", "true")
        poll(page, lambda: params(page).get("service") == ["website-design"], "service=website-design")
        assert params(page).get("category") == ["brand-identity"] and hash_of(page) == "services"
        click(service_button(page, "website-design"))
        expect(service_button(page, "website-design")).to_have_attribute("aria-expanded", "false")
        poll(page, lambda: "service" not in params(page), "closing removes the service parameter")
        assert params(page).get("category") == ["brand-identity"] and hash_of(page) == "services"
        assert history_len(page) == hist, "service changes add no history entry"
    with visit(browser, app_url + "/?service=website-design") as page:
        btn = service_button(page, "website-design")
        expect(btn).to_have_attribute("aria-expanded", "true")
        poll(page, lambda: btn.evaluate("el => document.activeElement === el && el.getBoundingClientRect().top >= 72"),
             "service button focused, clear of the header")
        for sid in ("brand-identity", "digital-product-design"):
            expect(service_button(page, sid)).to_have_attribute("aria-expanded", "false")


def test_service_work_link(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for sid, name in CATS.items():
        with visit(browser, app_url + "/") as page:
            watch_status(page)
            click(service_button(page, sid))
            settle(region(page, "services"))
            click(page.get_by_role("link", name=f"See {name} work", exact=True))
            expect(filter_group(page).get_by_role("radio", name=radio_name(sid, 3), exact=True)).to_be_checked()
            assert_jump(page, h2(page, "work"), JUMP_MS, f"See {name} work")
            assert params(page).get("category") == [sid]
            assert_announced(page, f"Showing 3 projects in {name}.", f"See {name} work")
            assert shown_slugs(page) == SEQUENCES[sid]


def test_service_work_link_keyboard_reduced(browser: Browser, app_url: str) -> None:
    restore(app_url)
    sid, name = "digital-product-design", CATS["digital-product-design"]
    with visit(browser, app_url + "/", reduced=True, record=True) as page:
        watch_status(page)
        services = region(page, "services")
        btn = service_button(page, sid)
        btn.focus()
        clear_recs(page)
        page.keyboard.press("Enter")
        expect(btn).to_have_attribute("aria-expanded", "true")
        expect(services.get_by_text(SERVICES[sid]["summary"], exact=True)).to_be_visible()
        advance(page, FRAME_MS)
        assert timed(recs(page, services)) == [], "reduced motion opens the panel at once"
        page.keyboard.press("Tab")
        expect(services.get_by_role("link", name=f"See {name} work", exact=True)).to_be_focused()
        clear_recs(page)
        page.keyboard.press("Enter")
        expect(filter_group(page).get_by_role("radio", name=radio_name(sid, 3), exact=True)).to_be_checked()
        assert_jump(page, h2(page, "work"), JUMP_MS, f"See {name} work by keyboard")
        assert params(page).get("category") == [sid], page.url
        assert_announced(page, f"Showing 3 projects in {name}.", f"See {name} work by keyboard")
        assert shown_slugs(page) == SEQUENCES[sid]
        advance(page, FRAME_MS)
        assert timed(recs(page, region(page, "work"))) == [], "reduced motion shows the filtered work at once"


def test_category_counts_follow_content(browser: Browser, app_url: str) -> None:
    restore(app_url)
    body = seed_body()
    body["projects"] = [p for p in body["projects"] if p["category"] != "digital-product-design"]
    for p in body["projects"]:
        if p["slug"] == "quarry-press":
            p["title"] = RENAMED_QUARRY
    extra = copy.deepcopy(PROJECTS[0])
    extra.update(slug="probe-addition", title=ADDED_TITLE)
    body["projects"].append(extra)
    counts = {c: sum(1 for p in body["projects"] if p["category"] == c) for c in CATS}
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/", reduced=True) as page:
            watch_status(page)
            group = filter_group(page)
            expect(group.get_by_role("radio", name=radio_name(None, len(body["projects"])), exact=True)).to_be_checked()
            assert shown_slugs(page) == [p["slug"] for p in body["projects"]]
            for c, n in counts.items():
                choose(group.get_by_role("radio", name=radio_name(c, n), exact=True))
                want = [p["slug"] for p in body["projects"] if p["category"] == c]
                poll(page, lambda w=want: shown_slugs(page) == w, f"{c} lists its {n} projects")
            expect(region(page, "work").get_by_text("No projects in Digital Product Design yet.", exact=True).first).to_be_visible()
            expect(page.get_by_role("list", name="Projects").get_by_role("listitem")).to_have_count(0)
            expect(page.get_by_role("link", name=RENAMED_QUARRY, exact=True)).to_have_count(0)
            choose(group.get_by_role("radio", name=radio_name("brand-identity", counts["brand-identity"]), exact=True))
            expect(page.get_by_role("link", name=RENAMED_QUARRY, exact=True)).to_have_count(1)
            expect(page.get_by_role("link", name=ADDED_TITLE, exact=True)).to_have_count(1)
    finally:
        restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        expect(filter_group(page).get_by_role("radio", name="All (9)", exact=True)).to_be_checked()


def test_grading_content_route(browser: Browser, app_url: str) -> None:
    def body_of(r: httpx.Response) -> Any:
        assert r.headers.get("content-type", "").lower().replace(" ", "").startswith("application/json;charset=utf-8"), r.headers
        return r.json()
    r = httpx.get(app_url + "/api/no-such-route", timeout=HTTP_S)
    assert r.status_code == 404 and body_of(r) == NOT_FOUND
    for method, path in [("PUT", "/api/grading/content"), ("DELETE", "/api/grading/content"), ("GET", "/api/grading/enquiries")]:
        for key in ("", "wrong-key-probe"):
            r = grading(method, app_url, path, key=key)
            assert r.status_code == 404 and body_of(r) == NOT_FOUND, f"{method} {path} with key {key!r}"
    for method, path in [("POST", "/api/grading/content"), ("GET", "/api/grading/content"), ("POST", "/api/grading/enquiries"), ("GET", "/api/enquiries"), ("POST", "/api/health")]:
        r = grading(method, app_url, path, key="")
        assert r.status_code == 405 and body_of(r) == METHOD, f"{method} {path} is the wrong method"
    prefix, suffix = '{"projects":[],"stats":[],"pad":"', '"}'
    exact = (prefix + "a" * (BODY_LIMIT - len(prefix) - len(suffix)) + suffix).encode()
    over = (prefix + "a" * (BODY_LIMIT + 1 - len(prefix) - len(suffix)) + suffix).encode()
    js = {"Content-Type": "application/json"}
    r = grading("PUT", app_url, content=over, key="", headers=js)
    assert r.status_code == 404 and body_of(r) == NOT_FOUND, "key check precedes the size limit"
    r = grading("PUT", app_url, content=over, headers=js)
    assert r.status_code == 413 and body_of(r) == TOO_LARGE
    r = grading("PUT", app_url, content=exact, headers=js)
    assert r.status_code == 422 and body_of(r) == SHAPE_ERROR, "exactly 262,144 bytes is allowed"
    r = grading("PUT", app_url, content=b"{not json", headers=js)
    assert r.status_code == 400 and body_of(r) == BAD_JSON
    r = httpx.post(app_url + "/api/enquiries", content=over, headers=js, timeout=HTTP_S)
    assert r.status_code == 413 and body_of(r) == TOO_LARGE
    eprefix = json.dumps(enquiry("pad@probe.example"))[:-1] + ', "pad": "'
    eexact = (eprefix + "a" * (BODY_LIMIT - len(eprefix.encode()) - len(suffix)) + suffix).encode()
    r = httpx.post(app_url + "/api/enquiries", content=eexact, headers=js, timeout=HTTP_S)
    assert r.status_code != 413, "an enquiry body of exactly 262,144 bytes passes the size check"
    r = httpx.post(app_url + "/api/enquiries", content=b"not json", headers=js, timeout=HTTP_S)
    assert r.status_code == 400 and body_of(r) == BAD_JSON
    restore(app_url)
    e1 = put_content(app_url, seed_body())
    assert e1 == 2
    r = grading("PUT", app_url, json={"projects": [], "stats": STATS})
    assert r.status_code == 422 and body_of(r) == SHAPE_ERROR
    assert put_content(app_url, seed_body()) == e1 + 1, "a refused PUT leaves the edition"
    restore(app_url)
    emails = [new_email("grading"), new_email("grading")]
    refs = []
    for em in emails:
        r = post_enquiry(app_url, enquiry(em, name="  Ada Probe  ", description="  " + DESC + "  "))
        assert r.status_code == 201, r.text
        refs.append(r.json()["reference"])
    listed = [e for e in enquiries(app_url) if e["email"] in emails]
    assert [e["reference"] for e in listed] == refs, "enquiries in the order stored"
    for e, em, ref in zip(listed, emails, refs):
        assert {k: e[k] for k in ("reference", "name", "email", "project_type", "budget", "description", "mail")} == {
            "reference": ref, "name": "Ada Probe", "email": em, "project_type": "brand-identity", "budget": "10k-25k",
            "description": DESC, "mail": "sent"}


def many_projects(n: int) -> list[dict[str, Any]]:
    out = []
    for i in range(n):
        p = copy.deepcopy(PROJECTS[i % len(PROJECTS)])
        p["slug"] = f"p{i}-probe"
        out.append(p)
    return out


def test_grading_content_shape(browser: Browser, app_url: str) -> None:
    def p0(b: dict[str, Any]) -> dict[str, Any]:
        return b["projects"][0]
    breaks: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        ("missing project key", lambda b: p0(b).pop("role")),
        ("extra project key", lambda b: p0(b).update(extra="x")),
        ("missing stat key", lambda b: b["stats"][0].pop("note")),
        ("extra stat key", lambda b: b["stats"][0].update(extra="x")),
        ("no projects", lambda b: b.update(projects=[])),
        ("too many projects", lambda b: b.update(projects=many_projects(MAX_PROJECTS + 1))),
        ("duplicate slug", lambda b: b["projects"][1].update(slug=p0(b)["slug"])),
        ("uppercase slug", lambda b: p0(b).update(slug="Harbour-loom")),
        ("slug starts with digit", lambda b: p0(b).update(slug="9-loom")),
        ("one-character slug", lambda b: p0(b).update(slug="h")),
        ("long slug", lambda b: p0(b).update(slug="a" * (SLUG_MAX + 1))),
        ("unknown category", lambda b: p0(b).update(category="illustration")),
        ("year too low", lambda b: p0(b).update(year=YEAR_RANGE[0] - 1)),
        ("year too high", lambda b: p0(b).update(year=YEAR_RANGE[1] + 1)),
        ("fractional year", lambda b: p0(b).update(year=YEAR_RANGE[0] + 0.5)),
        ("negative hue", lambda b: p0(b).update(hue=-1)),
        ("hue too high", lambda b: p0(b).update(hue=HUE_MAX + 1)),
        ("unknown motif", lambda b: p0(b).update(motif="dots")),
        ("no objectives", lambda b: p0(b).update(objectives=[])),
        ("six objectives", lambda b: p0(b).update(objectives=["x"] * 6)),
        ("no palette", lambda b: p0(b).update(palette=[])),
        ("six palette colours", lambda b: p0(b).update(palette=[{"name": "x", "hex": "#000000"}] * 6)),
        ("hex without hash", lambda b: p0(b)["palette"][0].update(hex="1F3A5F")),
        ("short hex", lambda b: p0(b)["palette"][0].update(hex="#1F3A5")),
        ("non-hex digit", lambda b: p0(b)["palette"][0].update(hex="#1F3A5G")),
        ("palette extra key", lambda b: p0(b)["palette"][0].update(extra="x")),
        ("no screens", lambda b: p0(b).update(screens=[])),
        ("seven screens", lambda b: p0(b).update(screens=[{"caption": "x"}] * 7)),
        ("three process numbers", lambda b: p0(b).update(process=[2, 2, 3])),
        ("process zero", lambda b: p0(b).update(process=[0, 2, 3, 2])),
        ("process too high", lambda b: p0(b).update(process=[PROCESS_MAX + 1, 2, 3, 2])),
        ("fractional process", lambda b: p0(b).update(process=[2.5, 2, 3, 2])),
        ("no results", lambda b: p0(b).update(results=[])),
        ("five results", lambda b: p0(b).update(results=[{"value": "1", "label": "x"}] * 5)),
        ("no stats", lambda b: b.update(stats=[])),
        ("five stats", lambda b: b.update(stats=[dict(copy.deepcopy(STATS[0]), id=f"s{i}") for i in range(5)])),
        ("duplicate stat ids", lambda b: b["stats"][1].update(id="years")),
        ("stat value zero", lambda b: b["stats"][0].update(value=0, parts=[{"label": "a", "value": 0}, {"label": "b", "value": 0}])),
        ("stat value too high", lambda b: b["stats"][0].update(value=STAT_MAX + 1, parts=[{"label": "a", "value": STAT_MAX}, {"label": "b", "value": 1}])),
        ("one part", lambda b: b["stats"][0].update(parts=[{"label": "a", "value": STATS[0]["value"]}])),
        ("five parts", lambda b: b["stats"][3].update(value=5, parts=[{"label": "a", "value": 1}] * 5)),
        ("parts do not add up", lambda b: b["stats"][0]["parts"][0].update(value=STATS[0]["parts"][0]["value"] + 1)),
        ("empty text", lambda b: p0(b).update(standfirst="")),
        ("text too long", lambda b: p0(b).update(overview="x" * (TEXT_MAX + 1))),
        ("stat note too long", lambda b: b["stats"][0].update(note="x" * (TEXT_MAX + 1))),
        ("text field not a string", lambda b: p0(b).update(title=5)),
    ]
    restore(app_url)
    try:
        start = put_content(app_url, seed_body())
        for label, mutate in breaks:
            b = seed_body()
            mutate(b)
            r = grading("PUT", app_url, json=b)
            assert r.status_code == 422 and r.json() == SHAPE_ERROR, f"{label}: {r.status_code} {r.text}"
        limits = seed_body()
        limits["projects"] = many_projects(MAX_PROJECTS)
        lp = limits["projects"]
        lp[0].update(slug="ab", year=YEAR_RANGE[0], hue=0, process=[1, 1, 1, 1], overview="x" * TEXT_MAX)
        lp[1].update(slug="a" + "b" * (SLUG_MAX - 1), year=YEAR_RANGE[1], hue=HUE_MAX, process=[PROCESS_MAX] * 4,
                     objectives=["x"] * 5, palette=[{"name": "c", "hex": "#00aaFF"}] * 5, screens=[{"caption": "s"}] * 6,
                     results=[{"value": "1", "label": "r"}] * 4)
        lp[2].update(objectives=["x"], palette=[{"name": "c", "hex": "#000000"}], screens=[{"caption": "s"}], results=[{"value": "1", "label": "r"}])
        limits["stats"][0].update(value=STAT_MAX, parts=[{"label": "a", "value": STAT_MAX - 3}, {"label": "b", "value": 1}, {"label": "c", "value": 1}, {"label": "d", "value": 1}])
        limits["stats"][1].update(value=1, parts=[{"label": "a", "value": 1}, {"label": "b", "value": 0}])
        assert put_content(app_url, limits) == start + 1, "refused PUTs never moved the edition"
        single = seed_body()
        single["projects"] = single["projects"][:1]
        single["stats"] = single["stats"][:1]
        assert put_content(app_url, single) == start + 2
    finally:
        restore(app_url)


def test_filter_radios_and_announcements(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        watch_status(page)
        group = filter_group(page)
        for cat in ["brand-identity", "website-design", "digital-product-design", None]:
            choose(group.get_by_role("radio", name=radio_name(cat, 3 if cat else 9), exact=True))
            want = SEQUENCES[cat] if cat else SLUGS
            poll(page, lambda w=want: shown_slugs(page) == w, f"gallery lists {cat or 'all'} in published order")
            assert_announced(page, f"Showing 3 projects in {CATS[cat]}." if cat else "Showing 9 projects.", f"click {cat}")
        group.get_by_role("radio", name="All (9)", exact=True).focus()
        order: list[str | None] = [None, *CATS]
        idx = 0
        for key, step in [("ArrowRight", 1), ("ArrowDown", 1), ("ArrowUp", -1), ("ArrowLeft", -1), ("ArrowLeft", -1), ("ArrowRight", 1)]:
            idx = (idx + step) % 4
            cat = order[idx]
            page.keyboard.press(key)
            radio = group.get_by_role("radio", name=radio_name(cat, 3 if cat else 9), exact=True)
            expect(radio).to_be_checked()
            expect(radio).to_be_focused()
            assert_announced(page, f"Showing 3 projects in {CATS[cat]}." if cat else "Showing 9 projects.", f"{key} to {cat}")
    body = seed_body()
    body["projects"] = [p for p in body["projects"] if p["slug"] not in ("fieldwork-journal", "ostler-hotels")]
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/") as page:
            watch_status(page)
            choose(filter_group(page).get_by_role("radio", name=radio_name("website-design", 1), exact=True))
            poll(page, lambda: shown_slugs(page) == ["northlight-gallery"], "one Website Design project")
            assert_announced(page, "Showing 1 project in Website Design.", "singular announcement")
    finally:
        restore(app_url)


def test_filter_in_address(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/?service=website-design#work", reduced=True) as page:
        hist = history_len(page)
        group = filter_group(page)
        choose(group.get_by_role("radio", name="Brand Identity (3)", exact=True))
        poll(page, lambda: params(page).get("category") == ["brand-identity"], "category=brand-identity")
        assert params(page).get("service") == ["website-design"] and hash_of(page) == "work"
        choose(group.get_by_role("radio", name="All (9)", exact=True))
        poll(page, lambda: "category" not in params(page), "All removes the category parameter")
        assert params(page).get("service") == ["website-design"] and hash_of(page) == "work"
        assert history_len(page) == hist
    for suffix in ["/?category=website-design", "/?category=website-design#work"]:
        with visit(browser, app_url + suffix) as page:
            watch_status(page)
            expect(filter_group(page).get_by_role("radio", name="Website Design (3)", exact=True)).to_be_checked()
            assert shown_slugs(page) == SEQUENCES["website-design"]
            advance(page, SETTLE_MS)
            assert announcements(page) == [] and norm(status(page).text_content()) == ""
    with visit(browser, app_url + "/?category=no-such-category") as page:
        expect(filter_group(page).get_by_role("radio", name="All (9)", exact=True)).to_be_checked()
        assert shown_slugs(page) == SLUGS


def test_hidden_projects_and_columns(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/?category=brand-identity", reduced=True) as page:
        filter_group(page).get_by_role("radio", name="Brand Identity (3)", exact=True).focus()
        names = tab_names(page, 4)
        assert names[:3] == ["Harbour Loom", "Quarry Press", "Tidewater Co-op"], names
        assert names[3] not in [p["title"] for p in PROJECTS]
        for p in PROJECTS:
            want = 1 if p["category"] == "brand-identity" else 0
            expect(page.get_by_role("list", name="Projects").get_by_role("link", name=p["title"], exact=True)).to_have_count(want)
    with visit(browser, app_url + "/", reduced=True) as page:
        for width, cols in COLUMNS.items():
            page.set_viewport_size({"width": width, "height": DESKTOP[1]})
            def ok(c: int = cols) -> bool:
                xs = page.locator("[data-project]").evaluate_all("els => els.map(e => e.getBoundingClientRect().left)")
                return distinct(xs) == c
            poll(page, ok, f"{cols} gallery columns at {width} px")


def hero_move(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    best, change = None, 1.0
    for e in timed(entries):
        if e["hero"] and e.get("hstart") and e.get("hend"):
            c = sum(abs(e["hstart"][k] - e["hend"][k]) for k in ("x", "y", "w", "h"))
            if c > change:
                best, change = e, c
    return best


def title_entries(page: Page, slug: str) -> list[dict[str, Any]]:
    p = BY_SLUG[slug]
    locs = [page.get_by_text(f"{CATS[p['category']]} · {p['year']}", exact=True).first, h1(page), page.get_by_text(p["standfirst"], exact=True).first]
    out = []
    for loc in locs:
        es = [e for e in timed(recs(page, loc)) if e["rel"] in ("self", "inside") and e.get("start") and e["begin"] is not None]
        out.append(max(es, key=lambda e: rise(e)) if es else None)
    return out


def assert_title_rise(page: Page, slug: str, after_ms: float) -> None:
    poll(page, lambda: all(title_entries(page, slug)), "eyebrow, heading and standfirst rise animations")
    ents = title_entries(page, slug)
    for e in ents:
        assert in_range(e["duration"], TITLE_MS), f"title line over {TITLE_MS} ms, got {e['duration']}"
        assert abs(rise(e) - TITLE_RISE_PX) <= GEOM_TOL_PX, f"title line rises {TITLE_RISE_PX} px, got {rise(e)}"
        assert e["start"]["o"] < e["end"]["o"], "title line fades in"
    assert ents[0]["begin"] >= after_ms - FRAME_MS, "title lines rise after the hero move ends"
    for a, b in zip(ents, ents[1:]):
        assert in_range(b["begin"] - a["begin"], (TITLE_STAGGER_MS[0] - 1, TITLE_STAGGER_MS[1] + 1)), f"stagger {b['begin'] - a['begin']}"


def test_cover_carry_motion(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", record=True) as page:
        it = item(page, "harbour-loom")
        scroll_to(page, doc_top(it) - HEADER_PX * 2)
        settle(it)
        cover = box(it.locator("[data-cover]"))
        page.evaluate("(v) => { window.__kept = v; }", KEPT_MARK)
        hist = history_len(page)
        clear_recs(page)
        click(it.get_by_role("link", name="Harbour Loom", exact=True))
        poll(page, lambda: urlparse(page.url).path == "/work/harbour-loom", "address /work/harbour-loom")
        assert page.evaluate("() => window.__kept") == KEPT_MARK, "the document stays loaded"
        assert history_len(page) == hist + 1
        assert_case_arrival(page, "harbour-loom")
        poll(page, lambda: hero_move(recs(page)) is not None and hero_move(recs(page))["begin"] is not None, "hero move animation")
        mv = hero_move(recs(page))
        assert in_range(mv["duration"], CARRY_MS), f"hero move over {CARRY_MS} ms, got {mv['duration']}"
        for k in ("x", "y", "w", "h"):
            assert abs(mv["hstart"][k] - cover[k]) <= GEOM_TOL_PX, f"hero starts in the cover box ({k}: {mv['hstart'][k]} vs {cover[k]})"
        hero = page.get_by_role("main").locator("[data-hero]")
        ended = min(mv["begin"] + mv["duration"], page.evaluate("() => document.timeline.currentTime"))
        settle(hero)
        final = box(hero)
        for k in ("x", "y", "w", "h"):
            assert abs(mv["hend"][k] - final[k]) <= GEOM_TOL_PX, f"hero ends in its own box ({k})"
        assert_title_rise(page, "harbour-loom", ended)


def test_case_study_content(browser: Browser, app_url: str) -> None:
    restore(app_url)
    sections = ["Overview", "Objectives", "Visual system", "Showcase", "Process", "Results"]
    with visit(browser, app_url + "/privacy", reduced=True) as page:
        for p in PROJECTS:
            page.goto(app_url + f"/work/{p['slug']}")
            expect(page).to_have_title(f"{p['title']} | Sollis Studio")
            expect(h1(page)).to_have_accessible_name(p["title"])
            main = page.get_by_role("main")
            expect(main.get_by_role("heading", level=2)).to_have_text(sections)
            hero = page.get_by_role("main").locator("[data-hero]")
            expect(hero).to_have_attribute("role", "img")
            expect(page.get_by_role("img", name=f"{p['title']} cover", exact=True)).to_have_count(1)
            hb = box(hero)
            assert abs(hb["w"] / hb["h"] - 16 / 9) < 0.02, "hero on a 16:9 frame"
            expect(main.get_by_role("term")).to_have_text(["Client", "Year", "Service", "Role", "Duration"])
            expect(main.get_by_role("definition")).to_have_text([p["client"], str(p["year"]), CATS[p["category"]], p["role"], p["duration"]])
            steps = [f"{s} · {w} week{'s' if w != 1 else ''}" for s, w in zip(["Discover", "Define", "Design", "Deliver"], p["process"])]
            showcase = page.get_by_role("region", name="Showcase", exact=True)
            expect(showcase).to_have_attribute("data-screen", "1")
            expect(showcase.get_by_role("figure")).to_have_count(len(p["screens"]))
            expect(showcase.get_by_text(f"1 / {len(p['screens'])}", exact=True)).to_have_count(1)
            for s in steps:
                expect(main.get_by_role("listitem").filter(has_text=re.compile(f"^{re.escape(s)}$"))).to_have_count(1)
            in_order(main.text_content() or "", [
                f"{CATS[p['category']]} · {p['year']}", p["title"], p["standfirst"], "Overview", p["overview"],
                "Objectives", *p["objectives"], "Visual system", *[x for c in p["palette"] for x in (c["name"], c["hex"])],
                "Showcase", *[s["caption"] for s in p["screens"]], "Process", *steps,
                "Results", *[x for r in p["results"] for x in (r["value"], r["label"])]], p["slug"])
            assert before(main.get_by_role("heading", level=2, name="Results", exact=True), page.get_by_role("navigation", name="More work"))


def test_on_this_page_navigation(browser: Browser, app_url: str) -> None:
    restore(app_url)
    sections = ["Overview", "Objectives", "Visual system", "Showcase", "Process", "Results"]
    with visit(browser, app_url + "/work/ledgerline") as page:
        nav = page.get_by_role("navigation", name="On this page")
        expect(nav.get_by_role("link")).to_have_text(sections)
        scroll_to(page, 0)
        poll(page, lambda: nav.get_by_role("link").evaluate_all("as => as.filter(a => a.getAttribute('aria-current') === 'true').length") == 0,
             "no current link before Overview reaches the point")
        for s in sections:
            scroll_to(page, 0)
            click(nav.get_by_role("link", name=s, exact=True))
            assert_jump(page, page.get_by_role("heading", level=2, name=s, exact=True), JUMP_MS, f"On this page {s}")
        vh = page.evaluate("innerHeight")
        for s in sections + list(reversed(sections[:-1])):
            heading = page.get_by_role("heading", level=2, name=s, exact=True)
            scroll_to(page, doc_top(heading) - vh * POINT + 10)
            tops = [page.get_by_role("heading", level=2, name=x, exact=True).evaluate("el => el.getBoundingClientRect().top") for x in sections]
            passed = [x for x, t in zip(sections, tops) if t <= vh * POINT]
            want = passed[-1] if passed else None
            def ok(w: str | None = want) -> bool:
                cur = nav.get_by_role("link").evaluate_all("as => as.filter(a => a.getAttribute('aria-current') === 'true').map(a => a.textContent.trim())")
                return cur == ([w] if w else [])
            poll(page, ok, f"current On this page link {want}")


def test_not_found_pages(browser: Browser, app_url: str) -> None:
    cases = [("/work/no-such-project", "This project does not exist.", "All work", "/#work"),
             ("/no-such-page", "This page does not exist.", "Back to Sollis Studio", "/")]
    with visit(browser, app_url + "/privacy", reduced=True) as page:
        for path, heading, link, href in cases:
            assert httpx.get(app_url + path, timeout=HTTP_S).status_code == 404
            resp = page.goto(app_url + path)
            assert resp is not None and resp.status == 404
            expect(page).to_have_title(TITLE_NOT_FOUND)
            expect(h1(page)).to_have_text(heading)
            assert target(page.get_by_role("main").get_by_role("link", name=link, exact=True)) == href


def more_link(page: Page, kind: str) -> Locator:
    return page.get_by_role("navigation", name="More work").get_by_role("link", name=re.compile(f"^{kind} project: "))


def test_previous_next_links(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/privacy", reduced=True) as page:
        for cat, seq in [(None, SLUGS), *SEQUENCES.items()]:
            q = f"?category={cat}" if cat else ""
            for i, slug in enumerate(seq):
                page.goto(app_url + f"/work/{slug}{q}")
                more = page.get_by_role("navigation", name="More work")
                if i == 0:
                    expect(more_link(page, "Previous")).to_have_count(0)
                else:
                    link = more.get_by_role("link", name=f"Previous project: {BY_SLUG[seq[i - 1]]['title']}", exact=True)
                    assert target(link) == f"/work/{seq[i - 1]}{q}"
                if i == len(seq) - 1:
                    expect(more_link(page, "Next")).to_have_count(0)
                else:
                    link = more.get_by_role("link", name=f"Next project: {BY_SLUG[seq[i + 1]]['title']}", exact=True)
                    assert target(link) == f"/work/{seq[i + 1]}{q}"
                assert target(more.get_by_role("link", name="All work", exact=True)) == (f"/{q}#work" if cat else "/#work")
    body = seed_body()
    body["projects"][1]["title"] = RENAMED_NORTHLIGHT
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/work/harbour-loom", reduced=True) as page:
            expect(page.get_by_role("link", name=f"Next project: {RENAMED_NORTHLIGHT}", exact=True)).to_have_count(1)
    finally:
        restore(app_url)


def test_arrow_keys_between_projects(browser: Browser, app_url: str) -> None:
    restore(app_url)
    q = "?category=brand-identity"
    with visit(browser, app_url + f"/work/quarry-press{q}", reduced=True) as page:
        page.keyboard.press("ArrowRight")
        poll(page, lambda: page.url.endswith(f"/work/tidewater-co-op{q}"), "ArrowRight opens the next project")
        assert_case_arrival(page, "tidewater-co-op")
        page.keyboard.press("ArrowRight")
        advance(page, SETTLE_MS)
        assert page.url.endswith(f"/work/tidewater-co-op{q}"), "no next project after the last"
        page.get_by_role("navigation", name="More work").get_by_role("link", name="All work", exact=True).focus()
        page.keyboard.press("ArrowLeft")
        poll(page, lambda: page.url.endswith(f"/work/quarry-press{q}"), "ArrowLeft with focus on a link")
        assert_case_arrival(page, "quarry-press")
        page.keyboard.press("ArrowLeft")
        poll(page, lambda: page.url.endswith(f"/work/harbour-loom{q}"), "ArrowLeft to the first project")
        page.keyboard.press("ArrowLeft")
        advance(page, SETTLE_MS)
        assert page.url.endswith(f"/work/harbour-loom{q}"), "no previous project before the first"


def test_back_to_the_same_tile(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", record=True) as page:
        choose(filter_group(page).get_by_role("radio", name="Website Design (3)", exact=True))
        poll(page, lambda: shown_slugs(page) == SEQUENCES["website-design"], "Website Design filter")
        settle(page.get_by_role("list", name="Projects"))
        open_case_from_gallery(page, "northlight-gallery")
        assert_case_arrival(page, "northlight-gallery")
        for slug in ["fieldwork-journal", "ostler-hotels"]:
            click(more_link(page, "Next"))
            poll(page,
                 lambda s=slug: urlparse(page.url).path == f"/work/{s}" and params(page).get("category") == ["website-design"],
                 f"Next project to {slug} keeps category")
            assert_case_arrival(page, slug)
        expect(more_link(page, "Next")).to_have_count(0)
        for slug in ["fieldwork-journal", "northlight-gallery"]:
            page.go_back()
            poll(page, lambda s=slug: urlparse(page.url).path == f"/work/{s}", f"Back shows {slug}")
            assert_case_arrival(page, slug)
        hero = page.get_by_role("main").locator("[data-hero]")
        settle(hero)
        hero_box = box(hero)
        clear_recs(page)
        page.go_back()
        poll(page, lambda: urlparse(page.url).path == "/", "third Back returns to /")
        assert params(page).get("category") == ["website-design"]
        expect(filter_group(page).get_by_role("radio", name="Website Design (3)", exact=True)).to_be_checked()
        it = item(page, "northlight-gallery")
        link = it.get_by_role("link", name="Northlight Gallery", exact=True)
        poll(page, lambda: link.evaluate("el => document.activeElement === el"), "focus on the first-opened tile link")
        cover = it.locator("[data-cover]")
        poll(page, lambda: any(e.get("start") and in_range(e["duration"], CARRY_MS) for e in timed(recs(page, cover))),
             "cover carried back over the published duration")
        back = [e for e in timed(recs(page, cover)) if e.get("start") and in_range(e["duration"], CARRY_MS)]
        assert any(all(abs(e["start"][k] - hero_box[k]) <= GEOM_TOL_PX for k in ("x", "y", "w", "h")) for e in back), \
            "the cover starts in the hero's box"
        settle(it)
        ib, vh = box(it), page.evaluate("innerHeight")
        assert ib["y"] >= banner_bottom(page) - 0.5 and ib["b"] <= vh + 0.5, f"tile fully in view, clear of the header: {ib}"


def slide_entries(page: Page) -> list[dict[str, Any]]:
    return [e for e in timed(recs(page)) if e["hero"] and e.get("hstart") and e.get("hend") and in_range(e["duration"], SLIDE_MS)]


def assert_slide(page: Page, out_dx: float, what: str) -> float:
    def found() -> bool:
        es = slide_entries(page)
        leave = [e for e in es if abs((e["hend"]["x"] - e["hstart"]["x"]) - out_dx) <= GEOM_TOL_PX]
        enter = [e for e in es if abs((e["hstart"]["x"] - e["hend"]["x"]) + out_dx) <= GEOM_TOL_PX]
        return bool(leave) and bool(enter) and all(e["begin"] is not None for e in leave + enter)
    poll(page, found, f"{what}: old hero leaves {out_dx:+} px and the new one enters from {-out_dx:+} px over {SLIDE_MS} ms")
    es = slide_entries(page)
    assert any(e["start"]["o"] > e["end"]["o"] for e in es), f"{what}: old hero fades out"
    assert any(e["start"]["o"] < e["end"]["o"] for e in es), f"{what}: new hero fades in"
    return max(e["begin"] + e["duration"] for e in es)


def test_neighbour_slide_motion(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/northlight-gallery?category=website-design", record=True) as page:
        settle(page.get_by_role("main").locator("[data-hero]"))
        clear_recs(page)
        click(more_link(page, "Next"))
        poll(page, lambda: urlparse(page.url).path == "/work/fieldwork-journal", "Next project")
        end = assert_slide(page, -SLIDE_PX, "Next")
        assert_title_rise(page, "fieldwork-journal", end)
        settle(page.get_by_role("main"))
        clear_recs(page)
        click(more_link(page, "Previous"))
        poll(page, lambda: urlparse(page.url).path == "/work/northlight-gallery", "Previous project")
        end = assert_slide(page, SLIDE_PX, "Previous")
        assert_title_rise(page, "northlight-gallery", end)


def test_intro_and_reveal_motion(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", record=True) as page:
        lines = [page.locator(f'[data-line="{i}"]') for i in (1, 2, 3)]
        def line_entry(loc: Locator) -> dict[str, Any] | None:
            es = [e for e in timed(recs(page, loc)) if e["rel"] in ("self", "inside") and e.get("start") and e["begin"] is not None and rise(e) > 0]
            return max(es, key=rise) if es else None
        poll(page, lambda: all(line_entry(x) for x in lines), "intro line rise animations")
        ents = [line_entry(x) for x in lines]
        for e in ents:
            assert in_range(e["duration"], INTRO_LINE_MS), f"intro line over {INTRO_LINE_MS} ms, got {e['duration']}"
            h = e["end"]["h"]
            assert abs(rise(e) - h) <= LINE_TOL * h + GEOM_TOL_PX, f"rises one line height ({h}), got {rise(e)}"
        for a, b in zip(ents, ents[1:]):
            assert in_range(b["begin"] - a["begin"], (INTRO_STAGGER_MS[0] - 1, INTRO_STAGGER_MS[1] + 1))
        assert ents[-1]["begin"] + ents[-1]["duration"] <= INTRO_DONE_MS
        vh = page.evaluate("innerHeight")
        for sid in SECTION_IDS[1:]:
            heading = h2(page, sid)
            scroll_to(page, doc_top(heading) - vh * (HEADING_EDGE - 0.15))
            def hentry(hd: Locator = heading) -> list[dict[str, Any]]:
                return [e for e in timed(recs(page, hd)) if e["rel"] in ("self", "inside") and e.get("start")]
            poll(page, lambda: bool(hentry()), f"{sid} heading reveal")
            e = max(hentry(), key=rise)
            assert in_range(e["duration"], HEADING_MS), f"{sid} heading over {HEADING_MS} ms"
            assert abs(rise(e) - HEADING_RISE_PX) <= GEOM_TOL_PX and e["start"]["o"] < e["end"]["o"]
            n = len(hentry())
            scroll_to(page, 0)
            advance(page, SETTLE_MS)
            scroll_to(page, doc_top(heading) - vh * (HEADING_EDGE - 0.15))
            advance(page, SETTLE_MS)
            assert len(hentry()) == n, f"{sid} heading reveals once per page load"
        cover = item(page, "harbour-loom").locator("[data-cover]")
        scroll_to(page, doc_top(cover) - vh * (COVER_EDGE - 0.1))
        poll(page, lambda: any(in_range(e["duration"], COVER_REVEAL_MS) for e in timed(recs(page, cover))), "cover reveal 600-800 ms")
        n = len(timed(recs(page, cover)))
        scroll_to(page, 0)
        advance(page, SETTLE_MS)
        scroll_to(page, doc_top(cover) - vh * (COVER_EDGE - 0.1))
        advance(page, SETTLE_MS)
        assert len(timed(recs(page, cover))) == n, "cover reveals once per page load"


def hover_state(page: Page, it: Locator) -> tuple[float, float]:
    settle(it)
    cover = it.locator("[data-cover]")
    cap = it.get_by_text("View case study", exact=True)
    return float(cover.evaluate(MAX_WIDTH_JS)), box(cap)["y"] - box(it)["y"]


def test_work_item_hover_and_focus(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", record=True) as page:
        it = item(page, "harbour-loom")
        scroll_to(page, doc_top(it) - HEADER_PX * 2)
        settle(it)
        page.mouse.move(1, DESKTOP[1] - 1)
        rest_w, rest_y = hover_state(page, it)
        cap = it.get_by_text("View case study", exact=True)
        rest_o = float(style(cap, "opacity")["opacity"])
        for mode in ("hover", "focus"):
            clear_recs(page)
            if mode == "hover":
                ib = box(it)
                page.mouse.move(ib["x"] + ib["w"] / 2, ib["y"] + ib["h"] / 2)
            else:
                filter_group(page).get_by_role("radio", name="All (9)", exact=True).focus()
                page.keyboard.press("Tab")
                expect(it.get_by_role("link", name="Harbour Loom", exact=True)).to_be_focused()
            poll(page, lambda: len(timed(recs(page, it))) >= 2, f"{mode}: cover and caption transitions")
            es = timed(recs(page, it))
            assert any(in_range(e["duration"], COVER_SCALE_MS) for e in es), f"{mode}: cover scale over {COVER_SCALE_MS} ms"
            assert any(in_range(e["duration"], CAPTION_MS) for e in timed(recs(page, cap))), f"{mode}: caption over {CAPTION_MS} ms"
            w, y = hover_state(page, it)
            assert abs(w / rest_w - COVER_SCALE) <= 0.005, f"{mode}: cover scales to 1.04, got {w / rest_w}"
            assert abs((rest_y - y) - CAPTION_RISE_PX) <= GEOM_TOL_PX, f"{mode}: caption rises 8 px, got {rest_y - y}"
            assert float(style(cap, "opacity")["opacity"]) > rest_o
            if mode == "hover":
                page.mouse.move(1, DESKTOP[1] - 1)
            else:
                page.keyboard.press("Tab")
            w, y = hover_state(page, it)
            assert abs(w - rest_w) <= 0.5 and abs(y - rest_y) <= 0.5, f"{mode}: leaving reverses both"


def test_intro_plate_follows_scroll(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        for s in PLATE_POSITIONS:
            scroll_to(page, s)
            want = math.floor(PLATE_RATE * min(s, PLATE_CAP) + 0.5)
            poll(page, lambda w=want: abs(plate_y(page) - w) <= 0.5, f"plate translateY {want} px at scroll {s}")


def test_reduced_motion_end_states(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True, record=True) as page:
        watch_status(page)
        advance(page, FRAME_MS)
        for s in PLATE_POSITIONS:
            scroll_to(page, s)
            advance(page, STEP_MS)
            assert abs(plate_y(page)) <= 0.5, f"plate stays at 0 at scroll {s}"
        for sid in SECTION_IDS[1:]:
            scroll_to(page, doc_top(h2(page, sid)) - DESKTOP[1] / 2)
            advance(page, FRAME_MS)
            assert float(style(h2(page, sid), "opacity")["opacity"]) == 1
        choose(filter_group(page).get_by_role("radio", name="Website Design (3)", exact=True))
        assert_announced(page, "Showing 3 projects in Website Design.", "reduced-motion filter")
        hist = history_len(page)
        open_case_from_gallery(page, "northlight-gallery")
        assert history_len(page) == hist + 1
        assert_case_arrival(page, "northlight-gallery")
        click(more_link(page, "Next"))
        poll(page, lambda: urlparse(page.url).path == "/work/fieldwork-journal", "Next under reduced motion")
        assert_case_arrival(page, "fieldwork-journal")
        page.go_back()
        poll(page, lambda: urlparse(page.url).path == "/work/northlight-gallery", "Back to Northlight Gallery")
        assert_case_arrival(page, "northlight-gallery")
        page.go_back()
        poll(page, lambda: urlparse(page.url).path == "/", "Back to /")
        link = item(page, "northlight-gallery").get_by_role("link", name="Northlight Gallery", exact=True)
        poll(page, lambda: link.evaluate("el => document.activeElement === el"), "focus back on the tile link")
        advance(page, FRAME_MS)
        moving = [e for e in timed(recs(page)) if e["pseudo"] is None]
        assert moving == [], f"reduced motion: no timed animation, got {[(e['props'], e['duration']) for e in moving][:5]}"


def test_tab_order_and_skip_link(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        assert tab_names(page, len(DESKTOP_TABS)) == DESKTOP_TABS
    for size in (TABLET, PHONE):
        with visit(browser, app_url + "/", size=size) as page:
            assert tab_names(page, len(SMALL_TABS)) == SMALL_TABS, f"first stops at {size}"
    with visit(browser, app_url + "/") as page:
        skip = page.get_by_role("link", name="Skip to content", exact=True)
        b = box(skip)
        hidden = b["w"] <= 1 or b["h"] <= 1 or b["b"] <= 0 or b["r"] <= 0 or b["y"] >= DESKTOP[1] or float(style(skip, "opacity")["opacity"]) == 0
        assert hidden, f"skip link hidden until focused: {b}"
        page.keyboard.press("Tab")
        expect(skip).to_be_focused()
        poll(page, lambda: (lambda r: r["w"] > 1 and r["h"] > 1 and r["y"] >= 0 and r["b"] <= DESKTOP[1])(box(skip))
             and float(style(skip, "opacity")["opacity"]) > 0, "skip link visible while focused")
        page.keyboard.press("Enter")
        poll(page, lambda: h1(page).evaluate("el => document.activeElement === el"), "skip link focuses the level-1 heading")


def test_focus_visible_and_clear(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        banner = page.get_by_role("banner").element_handle()
        prev = None
        for i in range(TAB_SWEEP + 10):
            page.keyboard.press("Tab" if i < TAB_SWEEP else "Shift+Tab")
            el = page.evaluate_handle("() => document.activeElement")
            if page.evaluate("e => e === document.body || e === document.documentElement", el):
                prev = None
                continue
            def probe() -> tuple[bool, Any]:
                st = page.evaluate(FOCUS_JS, [el, banner])
                if not st["sized"] or st["banner"] or st["name"] == "Skip to content":
                    return True, 0
                fits = st["bottom"] - st["top"] <= st["vh"] - FOCUS_TOP_PX
                ok = st["top"] >= FOCUS_TOP_PX - 0.5 and (not fits or st["bottom"] <= st["vh"] + 0.5)
                return ok, round(st["top"])
            reach(page, probe, JUMP_MS, f"focused control {i} scrolled clear of the header")
            st = page.evaluate(FOCUS_JS, [el, banner])
            assert st["os"] != "none" and st["ow"] >= RING_PX, f"focus ring on {st['name']!r}: {st['os']} {st['ow']}px"
            assert contrast(st["oc"], st["bg"]) >= RING_CONTRAST, f"ring contrast on {st['name']!r}"
            if prev is not None:
                ps = page.evaluate(FOCUS_JS, [prev, banner])
                assert ps["os"] == "none" or ps["ow"] == 0 or (len(ps["oc"]) > 3 and ps["oc"][3] == 0), \
                    f"ring absent once {ps['name']!r} loses focus"
            prev = el


def test_menu_dialog_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=TABLET) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        dialog = page.get_by_role("dialog", name="Menu")
        expect(page.get_by_role("navigation", name="Main")).to_have_count(0)
        expect(dialog).to_have_count(0)
        assert "Close menu" not in tab_names(page, 8)
        for key in ("Enter", "Space"):
            menu.focus()
            page.keyboard.press(key)
            poll(page, lambda: dialog.count() == 1, f"{key} opens dialog Menu")
            assert dialog.evaluate("el => el.getAttribute('aria-modal') === 'true' || el.matches(':modal')")
            expect(dialog.get_by_role("link", name="About", exact=True)).to_be_focused()
            expect(dialog.get_by_role("button", name="Close menu", exact=True)).to_have_count(1)
            nav = dialog.get_by_role("navigation", name="Menu sections")
            expect(nav.get_by_role("link")).to_have_text(list(NAV_LINKS))
            handle = dialog.element_handle()
            for k in ["Tab"] * 8 + ["Shift+Tab"] * 8:
                page.keyboard.press(k)
                assert page.evaluate("d => d.contains(document.activeElement)", handle), f"{k} stays inside the dialog"
            if key == "Enter":
                page.keyboard.press("Escape")
            else:
                dialog.get_by_role("button", name="Close menu", exact=True).focus()
                page.keyboard.press("Enter")
            poll(page, lambda: dialog.count() == 0, "menu closes")
            expect(menu).to_be_focused()
        page.keyboard.press("Enter")
        poll(page, lambda: dialog.count() == 1, "menu reopens")
        dialog.get_by_role("link", name="Work", exact=True).focus()
        page.keyboard.press("Enter")
        poll(page, lambda: dialog.count() == 0, "choosing a link closes the menu")
        assert_jump(page, h2(page, "work"), JUMP_MS, "menu link Work")


def test_phone_layout_and_tap_targets(browser: Browser, app_url: str) -> None:
    restore(app_url)
    roles = ["link", "button", "radio", "tab", "combobox", "textbox"]
    for path in ["/", "/work/harbour-loom", "/privacy"]:
        with visit(browser, app_url + path, size=PHONE, reduced=True) as page:
            layout(page)
            small = []
            for role in roles:
                for loc in page.get_by_role(role).all():
                    if not loc.is_visible():
                        continue
                    u = loc.evaluate(UNION_JS)
                    name = norm(loc.text_content())[:40]
                    if u and name != "Skip to content" and (u["w"] < TARGET_PX - 0.5 or u["h"] < TARGET_PX - 0.5):
                        small.append((role, name, round(u["w"]), round(u["h"])))
            assert small == [], f"{path}: controls under 44x44 px: {small}"
            if path == "/":
                page.keyboard.press("Tab")
                u = page.get_by_role("link", name="Skip to content", exact=True).evaluate(UNION_JS)
                assert u["w"] >= TARGET_PX - 0.5 and u["h"] >= TARGET_PX - 0.5
                for name in ("Statistics", "Process"):
                    rects = page.get_by_role("tablist", name=name).get_by_role("tab").evaluate_all(
                        "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top]; })")
                    assert distinct([r[1] for r in rects]) == 2 and distinct([r[0] for r in rects]) == 2, f"{name} tabs two rows of two"


def showcase_at(page: Page, k: int, n: int) -> bool:
    sc = page.get_by_role("region", name="Showcase", exact=True)
    if sc.get_attribute("data-screen") != str(k) or sc.get_by_text(f"{k} / {n}", exact=True).count() != 1:
        return False
    rb = box(sc)
    figs = sc.get_by_role("figure").evaluate_all("els => els.map(e => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; })")
    inside = [rb["x"] <= c <= rb["r"] for c in figs]
    return inside == [i == k - 1 for i in range(n)]


def test_showcase_swipe_and_buttons(browser: Browser, app_url: str) -> None:
    restore(app_url)
    caps = [s["caption"] for s in BY_SLUG["harbour-loom"]["screens"]]
    n = len(caps)
    with visit(browser, app_url + "/work/harbour-loom", size=PHONE) as page:
        s = touch(page)
        watch_status(page)
        sc = page.get_by_role("region", name="Showcase", exact=True)
        scroll_to(page, doc_top(sc) - HEADER_PX * 2)
        prev_b = sc.get_by_role("button", name="Previous screen", exact=True)
        next_b = sc.get_by_role("button", name="Next screen", exact=True)
        expect(prev_b).to_be_disabled()
        def go(k: int, what: str) -> None:
            reach(page, lambda: (showcase_at(page, k, n), k), SHOWCASE_MS, f"{what}: screen {k} in view")
            assert_announced(page, f"Screen {k} of {n}: {caps[k - 1]}.", what)
        click(next_b)
        go(2, "Next screen")
        click(next_b)
        go(3, "Next screen")
        expect(next_b).to_be_disabled()
        click(prev_b)
        go(2, "Previous screen")
        rb = box(sc)
        y = rb["y"] + rb["h"] / 3
        swipe(s, rb["x"] + rb["w"] / 2, y, -SHORT_SWIPE_PX)
        reach(page, lambda: (showcase_at(page, 2, n), 2), SHOWCASE_MS, "a 59 px swipe returns to the current screen")
        advance(page, SETTLE_MS)
        assert announcements(page) == []
        swipe(s, rb["x"] + rb["w"] / 2 + SWIPE_PX / 2, y, -SWIPE_PX)
        go(3, "60 px swipe left")
        swipe(s, rb["x"] + GEOM_TOL_PX * 5, y, LONG_SWIPE_PX)
        go(2, "long swipe right moves one screen")


def test_menu_by_tap(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=PHONE, record=True) as page:
        s = touch(page)
        menu = page.get_by_role("button", name="Menu", exact=True)
        dialog = page.get_by_role("dialog", name="Menu")
        def open_menu() -> Any:
            clear_recs(page)
            tap(menu)
            poll(page, lambda: dialog.count() == 1, "tap opens the menu")
            h = dialog.element_handle()
            poll(page, lambda: any(e.get("start") and in_range(e["duration"], MENU_MS) and e["end"]["y"] > e["start"]["y"]
                                   for e in timed(page.evaluate(RECS_JS, h))), "menu slides down over 200-350 ms")
            settle(dialog)
            clear_recs(page)
            return h
        def closed(h: Any, what: str) -> None:
            poll(page, lambda: any(e.get("start") and in_range(e["duration"], MENU_MS) and e["end"]["y"] < e["start"]["y"]
                                   for e in timed(page.evaluate(RECS_JS, h))), f"{what}: menu slides up")
            poll(page, lambda: dialog.count() == 0, f"{what}: menu closed")
        h = open_menu()
        page.keyboard.press("Tab")
        assert page.evaluate("d => d.contains(document.activeElement)", h)
        tap(dialog.get_by_role("button", name="Close menu", exact=True))
        closed(h, "Close menu")
        expect(menu).to_be_focused()
        h = open_menu()
        pt = page.evaluate("""(d) => { for (let y = innerHeight - 5; y > 72; y -= 20) for (let x = 5; x < innerWidth; x += 30) {
            const e = document.elementFromPoint(x, y); if (e && (e === d || !d.contains(e))) return [x, y]; } return null; }""", h)
        assert pt, "a point outside the menu panel"
        touch_tap(s, pt[0], pt[1])
        closed(h, "tap outside")
        expect(menu).to_be_focused()
        h = open_menu()
        tap(dialog.get_by_role("link", name="Contact", exact=True))
        closed(h, "menu link")
        assert_jump(page, h2(page, "contact"), JUMP_MS, "menu link Contact")


def error_links(page: Page) -> list[str]:
    box_ = page.get_by_role("heading", name=ERROR_HEADING, exact=True)
    expect(box_).to_have_count(1)
    container = page.get_by_role("link").filter(has_text=re.compile(r"\.$"))
    return [norm(t) for t in container.all_text_contents() if norm(t) in MSG.values()]


def test_enquiry_checks(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email = new_email("checks")
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and "/api/enquiries" in r.url else None)
        watch_status(page)
        click(send_button(page))
        poll(page, lambda: page.get_by_role("heading", name=ERROR_HEADING, exact=True).count() == 1, "error box")
        assert ERROR_HEADING in page.evaluate("() => document.activeElement.textContent"), "the error box receives focus"
        want = [MSG["name_empty"], MSG["email_empty"], MSG["type"], MSG["budget"], MSG["desc_empty"]]
        assert error_links(page) == want
        for loc, msg in [(field(page, "Name"), want[0]), (field(page, "Email"), want[1]), (field(page, "Project description"), want[4])]:
            expect(loc).to_have_attribute("aria-invalid", "true")
            expect(loc).to_have_accessible_description(re.compile(re.escape(msg)))
        expect(form(page).get_by_role("combobox", name="Budget range")).to_have_attribute("aria-invalid", "true")
        group = form(page).get_by_role("radiogroup", name="Project type")
        assert "true" in (group.get_attribute("aria-invalid"), type_radio(page, "brand-identity").get_attribute("aria-invalid"))
        click(page.get_by_role("link", name=MSG["type"], exact=True))
        expect(type_radio(page, "brand-identity")).to_be_focused()
        fill(field(page, "Name"), "A")
        fill(field(page, "Email"), "name@company")
        choose(type_radio(page, "website-design"))
        select(form(page).get_by_role("combobox", name="Budget range"), BUDGETS["25k-50k"])
        fill(field(page, "Project description"), "x" * (DESC_MAX + 1))
        expect(field(page, "Project description")).to_have_accessible_description(re.compile("2,001 of 2,000 characters"))
        assert len(field(page, "Project description").input_value()) == DESC_MAX + 1, "input never stopped at 2,000"
        click(send_button(page))
        poll(page, lambda: error_links(page) == [MSG["name_len"], MSG["email_bad"], MSG["desc_len"]], "second set of errors")
        expect(form(page).get_by_role("combobox", name="Budget range")).not_to_have_attribute("aria-invalid", "true")
        assert type_radio(page, "website-design").get_attribute("aria-invalid") != "true"
        assert posts == [], "nothing is sent while checks fail"
        assert announcements(page) == []
    long_email = "a" * (EMAIL_MAX + 1 - len("@probe.example")) + "@probe.example"
    cases: list[tuple[dict[str, Any], dict[str, str]]] = [
        ({"name": "", "email": "", "project_type": "", "budget": "", "description": ""},
         {"name": MSG["name_empty"], "email": MSG["email_empty"], "project_type": MSG["type"], "budget": MSG["budget"], "description": MSG["desc_empty"]}),
        ({"name": "   "}, {"name": MSG["name_empty"]}),
        ({"name": " A "}, {"name": MSG["name_len"]}),
        ({"name": "a" * (NAME_MAX + 1)}, {"name": MSG["name_len"]}),
        ({"email": long_email}, {"email": MSG["email_bad"]}),
        ({"email": "name@company"}, {"email": MSG["email_bad"]}),
        ({"email": "na me@company.com"}, {"email": MSG["email_bad"]}),
        ({"email": "@company.com"}, {"email": MSG["email_bad"]}),
        ({"email": "name@.com"}, {"email": MSG["email_bad"]}),
        ({"project_type": "bogus"}, {"project_type": MSG["type"]}),
        ({"project_type": 5}, {"project_type": MSG["type"]}),
        ({"budget": "bogus"}, {"budget": MSG["budget"]}),
        ({"description": "x" * (DESC_MIN - 1)}, {"description": MSG["desc_len"]}),
        ({"description": "   " + "x" * (DESC_MIN - 1) + "  "}, {"description": MSG["desc_len"]}),
        ({"description": "😀" * (DESC_MIN - 1)}, {"description": MSG["desc_len"]}),
        ({"description": "x" * (DESC_MAX + 1)}, {"description": MSG["desc_len"]}),
        ({"name": "", "description": "x"}, {"name": MSG["name_empty"], "description": MSG["desc_len"]}),
        ({"submission_id": "not-a-uuid"}, {"submission_id": MSG["sub"]}),
    ]
    for over, fields in cases:
        b = {**enquiry(email), **over}
        r = post_enquiry(app_url, b)
        assert r.status_code == 422 and r.json() == {"error": "invalid", "fields": fields}, f"{over}: {r.status_code} {r.text}"
    for key in ("project_type", "budget", "submission_id"):
        b = enquiry(email)
        b.pop(key)
        r = post_enquiry(app_url, b)
        msg = {"project_type": MSG["type"], "budget": MSG["budget"], "submission_id": MSG["sub"]}[key]
        assert r.status_code == 422 and r.json() == {"error": "invalid", "fields": {key: msg}}, f"missing {key}"
    assert stored_for(app_url, email) == [], "refused enquiries store nothing"
    mail_absent(mail, email)
    valid = [{"name": "Ab"}, {"name": "a" * NAME_MAX}, {"description": "x" * DESC_MIN}, {"description": "x" * DESC_MAX},
             {"description": "😀" * DESC_MIN}, {"description": "😀" * DESC_MAX}]
    for over in valid:
        r = post_enquiry(app_url, enquiry(new_email("limit"), **over))
        assert r.status_code == 201, f"both limits allowed: {over} -> {r.text[:200]}"
    edge = f"{uuid.uuid4().hex}".ljust(EMAIL_MAX - len("@probe.example"), "a") + "@probe.example"
    assert post_enquiry(app_url, enquiry(edge)).status_code == 201, "a 254-character email is allowed"


def test_one_enquiry_per_submission_ui(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email = new_email("pending")
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        ids: list[str] = []
        page.on("request", lambda r: ids.append(json.loads(r.post_data or "{}").get("submission_id")) if r.method == "POST" and "/api/enquiries" in r.url else None)
        watch_status(page)
        fill_enquiry(page, "Ada Probe", email, "website-design", "over-50k", DESC)
        page.route("**/api/enquiries", lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        click(send_button(page))
        poll(page, lambda: page.get_by_role("alert").filter(has_text=NOT_SAVED).count() == 1, "not-saved alert")
        page.unroute("**/api/enquiries")
        with held(page, "**/api/enquiries") as gate:
            send_button(page).focus()
            for _ in range(3):
                page.keyboard.press("Enter")
            expect(send_button(page)).to_have_attribute("aria-disabled", "true")
            poll(page, lambda: norm(status(page).text_content()) == "Sending your enquiry.", "pending status")
            gate.release()
        ref = await_panel(page, "Ada")
        poll(page, lambda: norm(status(page).text_content()) == f"Enquiry {ref} sent.", "sent status")
        assert len(ids) == 2 and ids[0] == ids[1], f"one request per send, same submission id: {ids}"
    rows = stored_for(app_url, email)
    assert [r["reference"] for r in rows] == [ref]
    assert len(mail_for(mail, email, 2)) == 2


def test_enquiry_replay_and_concurrency(app_url: str, mail: Mailpit) -> None:
    email = new_email("replay")
    b = enquiry(email)
    first = post_enquiry(app_url, b)
    assert first.status_code == 201
    for again in (b, dict(b, name="", description="x", email=new_email("other"))):
        r = post_enquiry(app_url, again)
        assert r.status_code == 200 and r.json() == first.json(), "replay answers the first body"
    assert len(stored_for(app_url, email)) == 1
    assert len(mail_for(mail, email, 2)) == 2, "a replay sends no message"
    email2 = new_email("race")
    b2 = enquiry(email2)
    with ThreadPoolExecutor(5) as pool:
        rs = list(pool.map(lambda _: post_enquiry(app_url, b2), range(5)))
    codes = sorted(r.status_code for r in rs)
    assert codes == [200, 200, 200, 200, 201], codes
    assert len({json.dumps(r.json(), sort_keys=True) for r in rs}) == 1
    assert len(stored_for(app_url, email2)) == 1
    assert len(mail_for(mail, email2, 2)) == 2


def test_enquiry_references(app_url: str) -> None:
    restore(app_url)
    b1 = enquiry(new_email("ref"))
    assert post_enquiry(app_url, b1).json()["reference"] == "SOL-0001"
    assert post_enquiry(app_url, enquiry(new_email("ref"), name="")).status_code == 422
    assert post_enquiry(app_url, enquiry(new_email("ref"))).json()["reference"] == ref_for(2)
    assert post_enquiry(app_url, b1).json()["reference"] == "SOL-0001"
    with ThreadPoolExecutor(4) as pool:
        rs = list(pool.map(lambda _: post_enquiry(app_url, enquiry(new_email("ref"))), range(4)))
    assert sorted(r.json()["reference"] for r in rs) == [ref_for(n) for n in range(3, 7)]
    for r in rs:
        assert re.fullmatch(r"/briefs/[0-9a-f]{32}\.pdf", r.json()["brief_url"])


def test_studio_copy_and_acknowledgement(app_url: str, mail: Mailpit) -> None:
    email = new_email("mail")
    name = "  Zoë Ångström  "
    desc = "  Line one: café, naïve — résumé ✓\n\n  Indented second line\twith a tab\nThird line ends here.  "
    r = post_enquiry(app_url, enquiry(email, name=name, description=desc, project_type="not-sure", budget="under-10k"))
    assert r.status_code == 201 and r.json()["mail"] == "sent"
    ref = r.json()["reference"]
    sname, sdesc = name.strip(), desc.strip()
    [row] = stored_for(app_url, email)
    assert row["name"] == sname and row["description"] == sdesc and row["mail"] == "sent"
    msgs = mail_for(mail, email, 2)
    assert len(msgs) == 2
    lines = (f"Reference: {ref}\nName: {sname}\nEmail: {email}\nProject type: Not sure yet\nBudget range: Under €10,000\n\n"
             f"Project description:\n{sdesc}")
    studio = [m for m in msgs if addresses(m.get("To")) == [STUDIO_EMAIL]]
    ack = [m for m in msgs if addresses(m.get("To")) == [email]]
    assert len(studio) == 1 and len(ack) == 1
    s, a = studio[0], ack[0]
    for m in (s, a):
        assert addresses(m.get("From")) == [mail_from_address()]
        assert not m.get("HTML"), "plain-text message"
    assert addresses(s.get("ReplyTo")) == [email]
    assert s.get("Subject") == f"New enquiry {ref} · Not sure yet · Under €10,000"
    assert a.get("Subject") == f"Your enquiry {ref} to Sollis Studio"
    st, at = text(s).replace("\r\n", "\n"), text(a).replace("\r\n", "\n")
    assert st.startswith(lines), f"studio text starts with the field lines: {st[:300]!r}"
    assert at.startswith(f"Hello Zoë,\n\n{ACK_LINE}\n\n{lines}"), f"acknowledgement text: {at[:300]!r}"
    if s.get("Date") and a.get("Date"):
        assert mail_time(s["Date"]) <= mail_time(a["Date"]), "studio copy goes first"


def test_saved_without_mail_and_not_saved(browser: Browser, app_url: str, mail: Mailpit) -> None:
    assert MAIL_DOWN, "APP_MAIL_DOWN_URL"
    email = new_email("maildown")
    r = post_enquiry(MAIL_DOWN, enquiry(email))
    assert r.status_code == 201 and r.json()["mail"] == "not_sent"
    [row] = stored_for(MAIL_DOWN, email)
    assert row["mail"] == "not_sent" and row["reference"] == r.json()["reference"]
    mail_absent(mail, email)
    email2 = new_email("notsaved")
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        watch_status(page)
        fill_enquiry(page, VISITOR, email2, "brand-identity", "10k-25k", DESC)
        for mode in ("abort", "503"):
            def handler(route: Any, m: str = mode) -> None:
                if route.request.method != "POST":
                    route.continue_()
                elif m == "abort":
                    route.abort()
                else:
                    route.fulfill(status=503, content_type="application/json",
                                  body=json.dumps({"error": "unavailable", "message": "The enquiry could not be saved."}))
            page.route("**/api/enquiries", handler)
            click(send_button(page))
            poll(page, lambda: page.get_by_role("alert").filter(has_text=NOT_SAVED).count() == 1, f"{mode}: not-saved alert")
            assert field(page, "Name").input_value() == VISITOR and field(page, "Email").input_value() == email2
            assert field(page, "Project description").input_value() == DESC
            expect(type_radio(page, "brand-identity")).to_be_checked()
            expect(send_button(page)).not_to_have_attribute("aria-disabled", "true")
            assert norm(status(page).text_content()) == ""
            expect(page.get_by_role("heading", name=re.compile("^Thank you"))).to_have_count(0)
            page.unroute("**/api/enquiries")
    assert stored_for(app_url, email2) == []


def strip_ws(s: str) -> str:
    return re.sub(r"\s+", "", s)


def test_brief_pdf(app_url: str) -> None:
    run = "x" * 300
    long_desc = ("Committee brief line.\n" * 60 + run + "\n" + "word " * 400)[:DESC_MAX].strip()
    for desc in (DESC, long_desc):
        email = new_email("brief")
        r = post_enquiry(app_url, enquiry(email, name="Ada Probe", description=desc, project_type="digital-product-design", budget="25k-50k"))
        assert r.status_code == 201
        ref, url = r.json()["reference"], r.json()["brief_url"]
        assert re.fullmatch(r"/briefs/[0-9a-f]{32}\.pdf", url)
        pdf = httpx.get(app_url + url, timeout=HTTP_S)
        assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
        assert pdf.headers.get("content-disposition") == f'attachment; filename="{ref}-brief.pdf"'
        assert pdf_pages(pdf.content) == 1, "exactly one page"
        t = strip_ws(pdf_text(pdf.content))
        for line in [f"Project brief {ref}", "Sollis Studio", f"Reference: {ref}", "Name: Ada Probe", f"Email: {email}",
                     "Project type: Digital Product Design", "Budget range: €25,000 to €50,000", "Project description:"]:
            assert strip_ws(line) in t, f"PDF text holds {line!r}"
        assert strip_ws(desc) in t, "the whole description is in the PDF"
    for token in ["0" * 32, "not-a-token"]:
        assert httpx.get(app_url + f"/briefs/{token}.pdf", timeout=HTTP_S).status_code == 404


def test_brief_outage_and_health(browser: Browser, app_url: str) -> None:
    assert PDF_DOWN and MAIL_DOWN
    for base, want in [(app_url, "ok"), (PDF_DOWN, "unavailable"), (MAIL_DOWN, "unavailable")]:
        r = httpx.get(base + "/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": want}, f"{base}: {r.text}"
    email = new_email("pdfdown")
    r = post_enquiry(PDF_DOWN, enquiry(email))
    assert r.status_code == 201 and r.json()["mail"] == "sent"
    ref, url = r.json()["reference"], r.json()["brief_url"]
    assert [e["reference"] for e in stored_for(PDF_DOWN, email)] == [ref]
    with visit(browser, PDF_DOWN + "/privacy", reduced=True) as page:
        resp = page.goto(PDF_DOWN + url)
        assert resp is not None and resp.status == 503
        expect(page).to_have_title(TITLE_BRIEF_DOWN)
        expect(h1(page)).to_have_text("Your brief PDF is not available right now.")
        expect(page.get_by_text(f"Your enquiry {ref} is saved. Try the download again in a few minutes.", exact=True)).to_have_count(1)


def test_page_structure_and_boundary(browser: Browser, app_url: str) -> None:
    restore(app_url)
    pages = [("/", TITLE_HOME), ("/work/harbour-loom", "Harbour Loom | Sollis Studio"), ("/privacy", TITLE_PRIVACY),
             ("/work/no-such-project", TITLE_NOT_FOUND), ("/no-such-page", TITLE_NOT_FOUND)]
    secrets = [v for v in (KEY, os.environ.get("DATABASE_URL", ""), os.environ.get("GOTENBERG_URL", "")) if len(v) >= 6]
    pw = urlparse(os.environ.get("DATABASE_URL", "")).password
    if pw and len(pw) >= 6:
        secrets.append(pw)
    for path, title in pages:
        with visit(browser, app_url + path, reduced=True) as page:
            urls: list[str] = []
            bodies: list[str] = []
            page.on("request", lambda r: urls.append(r.url))
            def keep(resp: Any) -> None:
                try:
                    if same_origin(resp.url, app_url) and re.search(r"text|javascript|json|css", resp.headers.get("content-type", "")):
                        bodies.append(resp.text())
                except Exception:
                    pass
            page.on("response", keep)
            page.reload()
            expect(page).to_have_title(title)
            assert page.evaluate("document.documentElement.lang") == "en"
            expect(page.get_by_role("main")).to_have_count(1)
            expect(h1(page)).to_have_count(1)
            assert page.evaluate("(h) => Array.from(document.getElementsByTagName('meta')).every(m => (m.httpEquiv || '').toLowerCase() !== h)",
                                 "Content-Security-Policy".lower())
            axe(page)
            foreign = [u for u in urls if not u.startswith(("data:", "blob:", "about:")) and not same_origin(u, app_url)]
            assert foreign == [], f"{path}: browser only talks to the app, got {foreign[:5]}"
            for body in bodies:
                for sec in secrets:
                    assert sec not in body, f"{path}: a configuration value reached the browser"
    r = httpx.get(app_url + "/", headers={"Origin": "http://probe.example"}, timeout=HTTP_S)
    lower = {k.lower() for k in r.headers}
    assert not any(k.startswith("access-control-") for k in lower) and "Content-Security-Policy".lower() not in lower
    for path in ["/.env", "/package.json", "/package-lock.json", "/tsconfig.json", "/run.json", "/src/server.ts", "/server.ts"]:
        r = httpx.get(app_url + path, timeout=HTTP_S)
        assert r.status_code == 404 and "This page does not exist." in r.text, f"{path} answers the not-found page"


def test_wf_home_tour_header_jumps(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        heads = [norm(t) for t in page.get_by_role("heading", level=2).all_text_contents()]
        in_order(" ".join(heads), [REGION_NAMES[s] for s in SECTION_IDS[1:]], "home headings")
        nav = page.get_by_role("navigation", name="Main")
        for name, sid in NAV_LINKS.items():
            click(nav.get_by_role("link", name=name, exact=True))
            assert_jump(page, h2(page, sid), JUMP_MS, f"header {name}")
            expect(h2(page, sid)).to_have_text(REGION_NAMES[sid])
            if sid != "contact":
                poll(page, lambda n=name: page.evaluate(CURRENT_JS) in ([n], []) and n in page.evaluate(CURRENT_JS), f"{name} current")


def test_wf_home_tour_intro_links(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        click(region(page, "intro").get_by_role("link", name="Start a project", exact=True))
        assert_jump(page, h2(page, "contact"), JUMP_MS, "intro Start a project")
        scroll_to(page, 0)
        click(page.get_by_role("link", name="See selected work", exact=True))
        assert_jump(page, h2(page, "work"), JUMP_MS, "intro See selected work")
        click(page.get_by_role("navigation", name="Footer").get_by_role("link", name="Philosophy", exact=True))
        assert_jump(page, h2(page, "philosophy"), JUMP_MS, "footer Philosophy")
    with visit(browser, app_url + "/#services") as page:
        assert_jump(page, h2(page, "services"), FRAME_MS, "load /#services")


def test_wf_about_statistics_count_and_keys(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        tl = start_count(page)
        advance(page, COUNT_MS + 2 * FRAME_MS)
        assert count_texts(page) == [str(s["value"]) for s in STATS]
        tl.get_by_role("tab", name=STAT_TABS[0], exact=True).focus()
        for i, stat in enumerate(STATS):
            if i:
                page.keyboard.press("ArrowRight")
            panel = region(page, "about").get_by_role("tabpanel")
            expect(panel).to_contain_text(stat["note"])
            for p in stat["parts"]:
                expect(panel.get_by_text(f"{p['label']}: {p['value']}", exact=True)).to_have_count(1)
        page.keyboard.press("ArrowRight")
        expect(tl.get_by_role("tab", name=STAT_TABS[0], exact=True)).to_have_attribute("aria-selected", "true")


def test_wf_about_statistics_phone_reduced(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=PHONE, reduced=True) as page:
        tl = start_count(page)
        advance(page, FRAME_MS)
        assert count_texts(page) == [str(s["value"]) for s in STATS]
        tl.get_by_role("tab", name=STAT_TABS[0], exact=True).focus()
        page.keyboard.press("End")
        expect(region(page, "about").get_by_role("tabpanel")).to_contain_text(STATS[-1]["note"])
        page.keyboard.press("Home")
        expect(region(page, "about").get_by_role("tabpanel")).to_contain_text(STATS[0]["note"])


def test_wf_brand_identity_service_start_project(browser: Browser, app_url: str, mail: Mailpit) -> None:
    restore(app_url)
    email = new_email("brandlead")
    with visit(browser, app_url + "/", reduced=True) as page:
        btn = service_button(page, "brand-identity")
        btn.focus()
        page.keyboard.press("Enter")
        expect(btn).to_have_attribute("aria-expanded", "true")
        s = SERVICES["brand-identity"]
        in_order(region(page, "services").text_content() or "", [*s["caps"], *s["dels"], f"Typical engagement: {s['weeks']}"], "Brand Identity")
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="See Brand Identity work", exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="Start a Brand Identity project", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        poll(page, lambda: field(page, "Name").evaluate("el => document.activeElement === el && el.getBoundingClientRect().top >= 72"),
             "focus on Name clear of the header")
        expect(type_radio(page, "brand-identity")).to_be_checked()
        assert params(page).get("type") == ["brand-identity"] and params(page).get("service") == ["brand-identity"]
        expect(btn).to_have_attribute("aria-expanded", "true")
        fill(field(page, "Name"), "Ada Probe")
        fill(field(page, "Email"), email)
        select(form(page).get_by_role("combobox", name="Budget range"), BUDGETS["10k-25k"])
        fill(field(page, "Project description"), DESC)
        send_button(page).focus()
        page.keyboard.press("Enter")
        await_panel(page, "Ada")
    [row] = stored_for(app_url, email)
    assert row["project_type"] == "brand-identity"
    assert len(mail_for(mail, email, 2)) == 2


def test_wf_brand_identity_service_toggle(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        btn = service_button(page, "brand-identity")
        btn.focus()
        page.keyboard.press("Space")
        expect(btn).to_have_attribute("aria-expanded", "true")
        poll(page, lambda: params(page).get("service") == ["brand-identity"], "service set")
        page.keyboard.press("Space")
        expect(btn).to_have_attribute("aria-expanded", "false")
        poll(page, lambda: "service" not in params(page), "service removed")
        assert tab_names(page, 1) == ["Website Design"]


def test_wf_website_service_switch_and_share(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        service_button(page, "brand-identity").focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowDown")
        expect(service_button(page, "website-design")).to_be_focused()
        page.keyboard.press("Enter")
        expect(service_button(page, "brand-identity")).to_have_attribute("aria-expanded", "false")
        expect(service_button(page, "website-design")).to_have_attribute("aria-expanded", "true")
        expect(region(page, "services").get_by_text(SERVICES["website-design"]["summary"], exact=True)).to_be_visible()
        poll(page, lambda: params(page).get("service") == ["website-design"], "service=website-design")
        shared = page.url
    with visit(browser, shared) as page:
        btn = service_button(page, "website-design")
        expect(btn).to_have_attribute("aria-expanded", "true")
        poll(page, lambda: btn.evaluate("el => document.activeElement === el"), "shared address focuses Website Design")
        click(page.get_by_role("link", name="Start a Website Design project", exact=True))
        poll(page, lambda: type_radio(page, "website-design").is_checked(), "Website Design type checked")
        assert params(page).get("service") == ["website-design"]
        expect(btn).to_have_attribute("aria-expanded", "true")


def test_wf_website_service_arrow_keys(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True) as page:
        service_button(page, "digital-product-design").focus()
        page.keyboard.press("ArrowDown")
        expect(service_button(page, "brand-identity")).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(service_button(page, "digital-product-design")).to_be_focused()
        for sid in CATS:
            expect(service_button(page, sid)).to_have_attribute("aria-expanded", "false")


def test_wf_website_service_tablet_taps(browser: Browser, app_url: str) -> None:
    restore(app_url)
    sid, name = "website-design", CATS["website-design"]
    with visit(browser, app_url + "/", size=TABLET, reduced=True) as page:
        services = region(page, "services")
        btn = service_button(page, sid)
        tap(btn)
        expect(btn).to_have_attribute("aria-expanded", "true")
        poll(page, lambda: params(page).get("service") == [sid], f"a tap opens {name} and sets service={sid}")
        cap = box(services.get_by_role("heading", level=4, name="Capabilities", exact=True))
        dl = box(services.get_by_role("heading", level=4, name="Deliverables", exact=True))
        assert dl["x"] >= cap["r"] - 1 and abs(dl["y"] - cap["y"]) < cap["h"], f"lists side by side at 768: {cap} {dl}"
        tap(services.get_by_role("link", name=f"Start a {name} project", exact=True))
        poll(page, lambda: type_radio(page, sid).is_checked(), f"{name} project type checked")
        name_field = field(page, "Name")
        poll(page, lambda: name_field.evaluate(
            "(el, top) => document.activeElement === el && el.getBoundingClientRect().top >= top", FOCUS_TOP_PX),
            "Name focused clear of the header")
        assert params(page).get("type") == [sid] and params(page).get("service") == [sid], page.url
        expect(btn).to_have_attribute("aria-expanded", "true")
        tap(btn)
        expect(btn).to_have_attribute("aria-expanded", "false")
        poll(page, lambda: "service" not in params(page), "a tap that closes the service removes the service parameter")
        assert params(page).get("type") == [sid], "closing the service keeps the type parameter"


def test_wf_product_service_work_link(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        watch_status(page)
        click(service_button(page, "digital-product-design"))
        settle(region(page, "services"))
        click(page.get_by_role("link", name="See Digital Product Design work", exact=True))
        assert_jump(page, h2(page, "work"), JUMP_MS, "See Digital Product Design work")
        assert_announced(page, "Showing 3 projects in Digital Product Design.", "service work link")
        assert shown_slugs(page) == SEQUENCES["digital-product-design"]
        open_case_from_gallery(page, "pathway-transit")
        assert_case_arrival(page, "pathway-transit")
        assert params(page).get("category") == ["digital-product-design"]


def test_wf_product_service_content_change(browser: Browser, app_url: str) -> None:
    restore(app_url)
    body = seed_body()
    body["projects"] = [p for p in body["projects"] if p["slug"] != "pathway-transit"]
    for p in body["projects"]:
        if p["slug"] == "tally-kitchen":
            p["title"] = RENAMED_TALLY
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/") as page:
            watch_status(page)
            expect(filter_group(page).get_by_role("radio", name="Digital Product Design (2)", exact=True)).to_have_count(1)
            click(service_button(page, "digital-product-design"))
            settle(region(page, "services"))
            click(page.get_by_role("link", name="See Digital Product Design work", exact=True))
            assert_announced(page, "Showing 2 projects in Digital Product Design.", "after content change")
            assert shown_slugs(page) == ["ledgerline", "tally-kitchen"]
            open_case_from_gallery(page, "ledgerline")
            expect(page.get_by_role("link", name=f"Next project: {RENAMED_TALLY}", exact=True)).to_have_count(1)
    finally:
        restore(app_url)


def test_wf_work_filter_arrow_filter(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        watch_status(page)
        filter_group(page).get_by_role("radio", name="All (9)", exact=True).focus()
        for cat in CATS:
            page.keyboard.press("ArrowRight")
            expect(filter_group(page).get_by_role("radio", name=radio_name(cat, 3), exact=True)).to_be_checked()
            assert_announced(page, f"Showing 3 projects in {CATS[cat]}.", f"arrow to {cat}")
            assert shown_slugs(page) == SEQUENCES[cat]
        url = page.url
        page.reload()
        watch_status(page)
        expect(filter_group(page).get_by_role("radio", name="Digital Product Design (3)", exact=True)).to_be_checked()
        advance(page, SETTLE_MS)
        assert announcements(page) == [] and params(page).get("category") == ["digital-product-design"], url


def test_wf_work_filter_empty_category(browser: Browser, app_url: str) -> None:
    restore(app_url)
    body = seed_body()
    body["projects"] = [p for p in body["projects"] if p["category"] != "website-design"]
    try:
        put_content(app_url, body)
        with visit(browser, app_url + "/") as page:
            watch_status(page)
            choose(filter_group(page).get_by_role("radio", name="Website Design (0)", exact=True))
            assert_announced(page, "No projects in Website Design yet.", "empty category")
            expect(region(page, "work").get_by_text("No projects in Website Design yet.", exact=True).first).to_be_visible()
    finally:
        restore(app_url)


def test_wf_case_study_open_by_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/") as page:
        filter_group(page).get_by_role("radio", name="All (9)", exact=True).focus()
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        poll(page, lambda: urlparse(page.url).path == "/work/harbour-loom", "address /work/harbour-loom")
        assert_case_arrival(page, "harbour-loom")
        expect(page.get_by_role("img", name="Harbour Loom cover", exact=True)).to_have_count(1)
        nav = page.get_by_role("navigation", name="On this page")
        for s in ["Overview", "Objectives", "Visual system", "Showcase", "Process", "Results"]:
            click(nav.get_by_role("link", name=s, exact=True))
            assert_jump(page, page.get_by_role("heading", level=2, name=s, exact=True), JUMP_MS, s)


def test_wf_case_study_direct_load(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/ledgerline", record=True) as page:
        assert_title_rise(page, "ledgerline", 0)
        assert hero_move(recs(page)) is None, "no hero move on a direct load"
        resp = page.goto(app_url + "/work/no-such-project")
        assert resp is not None and resp.status == 404


def test_wf_project_sequence_step_and_back(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/?category=digital-product-design", reduced=True) as page:
        open_case_from_gallery(page, "ledgerline")
        click(more_link(page, "Next"))
        poll(page, lambda: urlparse(page.url).path == "/work/pathway-transit", "Next to Pathway")
        h1(page).focus()
        page.keyboard.press("ArrowRight")
        poll(page, lambda: urlparse(page.url).path == "/work/tally-kitchen", "ArrowRight to Tally")
        expect(more_link(page, "Next")).to_have_count(0)
        for slug in ["pathway-transit", "ledgerline"]:
            page.go_back()
            poll(page, lambda s=slug: urlparse(page.url).path == f"/work/{s}", f"Back to {slug}")
            assert_case_arrival(page, slug)
        page.go_back()
        poll(page, lambda: urlparse(page.url).path == "/", "Back to /")
        expect(filter_group(page).get_by_role("radio", name="Digital Product Design (3)", exact=True)).to_be_checked()
        link = item(page, "ledgerline").get_by_role("link", name="Ledgerline", exact=True)
        poll(page, lambda: link.evaluate("el => document.activeElement === el"), "focus on the Ledgerline tile")


def test_wf_project_sequence_unfiltered(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/harbour-loom", reduced=True) as page:
        for slug in ["northlight-gallery", "ledgerline"]:
            click(more_link(page, "Next"))
            poll(page, lambda s=slug: urlparse(page.url).path == f"/work/{s}", f"Next to {slug}")
        for slug in ["northlight-gallery", "harbour-loom"]:
            page.go_back()
            poll(page, lambda s=slug: urlparse(page.url).path == f"/work/{s}", f"Back to {slug}")
            assert_case_arrival(page, slug)
        expect(more_link(page, "Previous")).to_have_count(0)


def test_wf_motion_hover_tour(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", record=True) as page:
        poll(page, lambda: all(timed(recs(page, page.locator(f'[data-line="{i}"]'))) for i in (1, 2, 3)), "intro lines rise")
        scroll_to(page, doc_top(h2(page, "about")) - DESKTOP[1] / 2)
        poll(page, lambda: bool(timed(recs(page, h2(page, "about")))), "About heading reveals")
        it = item(page, "quarry-press")
        scroll_to(page, doc_top(it) - HEADER_PX * 2)
        settle(it)
        rest_w, _ = hover_state(page, it)
        b = box(it)
        page.mouse.move(b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)
        w, _ = hover_state(page, it)
        assert abs(w / rest_w - COVER_SCALE) <= 0.005
        assert float(style(it.get_by_text("View case study", exact=True), "opacity")["opacity"]) == 1
        for s in (PLATE_POSITIONS[1], 0):
            scroll_to(page, s)
            want = math.floor(PLATE_RATE * min(s, PLATE_CAP) + 0.5)
            poll(page, lambda w_=want: abs(plate_y(page) - w_) <= 0.5, f"plate at {s}")


def test_wf_motion_hover_reduced(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True, record=True) as page:
        scroll_to(page, PLATE_POSITIONS[1])
        advance(page, STEP_MS)
        assert abs(plate_y(page)) <= 0.5
        it = item(page, "harbour-loom")
        scroll_to(page, doc_top(it) - HEADER_PX * 2)
        settle(it)
        rest_w, _ = hover_state(page, it)
        clear_recs(page)
        b = box(it)
        page.mouse.move(b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)
        advance(page, FRAME_MS)
        w = float(it.locator("[data-cover]").evaluate(MAX_WIDTH_JS))
        assert abs(w / rest_w - COVER_SCALE) <= 0.005 and timed(recs(page, it)) == []


def test_wf_keyboard_journey_full(browser: Browser, app_url: str, mail: Mailpit) -> None:
    restore(app_url)
    email = new_email("keyboard")
    with visit(browser, app_url + "/", size=TABLET, reduced=True) as page:
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        poll(page, lambda: h1(page).evaluate("el => document.activeElement === el"), "skip to h1")
        page.get_by_role("button", name="Menu", exact=True).focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.count() == 1, "menu open")
        page.keyboard.press("Tab")
        poll(page, lambda: dialog.get_by_role("link", name="Services", exact=True).evaluate("el => document.activeElement === el"),
             "Tab to Services in the menu", seconds=2)
        page.keyboard.press("Enter")
        assert_jump(page, h2(page, "services"), FRAME_MS, "menu Services")
        page.keyboard.press("Tab")
        expect(service_button(page, "brand-identity")).to_be_focused()
        page.keyboard.press("Enter")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        assert_jump(page, h2(page, "work"), FRAME_MS, "See Brand Identity work")
        page.keyboard.press("Tab")
        expect(filter_group(page).get_by_role("radio", name="Brand Identity (3)", exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        poll(page, lambda: urlparse(page.url).path == "/work/harbour-loom", "case study by keyboard")
        page.go_back()
        poll(page, lambda: urlparse(page.url).path == "/", "back home")
        name_field = field(page, "Name")
        for _ in range(TAB_SWEEP * 2):
            if name_field.evaluate("el => document.activeElement === el"):
                break
            page.keyboard.press("Tab")
        expect(name_field).to_be_focused()
        page.keyboard.type("Ada Probe")
        page.keyboard.press("Tab")
        page.keyboard.type(email)
        page.keyboard.press("Tab")
        page.keyboard.press("Space")
        select(form(page).get_by_role("combobox", name="Budget range"), BUDGETS["over-50k"])
        field(page, "Project description").focus()
        page.keyboard.type(DESC)
        send_button(page).focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        await_panel(page, "Ada")
    assert len(stored_for(app_url, email)) == 1
    assert len(mail_for(mail, email, 2)) == 2


def test_wf_keyboard_journey_phone_menu(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=PHONE, reduced=True) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.count() == 1, "menu open")
        h = dialog.element_handle()
        for _ in range(8):
            page.keyboard.press("Shift+Tab")
            assert page.evaluate("d => d.contains(document.activeElement)", h)
        page.keyboard.press("Escape")
        poll(page, lambda: dialog.count() == 0, "menu closed")
        expect(menu).to_be_focused()


def test_wf_phone_touch_menu_service_filter(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=PHONE) as page:
        touch(page)
        tap(page.get_by_role("button", name="Menu", exact=True))
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.count() == 1, "tap opens the menu")
        settle(dialog)
        tap(dialog.get_by_role("link", name="Services", exact=True))
        poll(page, lambda: dialog.count() == 0, "menu closes")
        assert_jump(page, h2(page, "services"), JUMP_MS, "menu Services by tap")
        tap(service_button(page, "digital-product-design"))
        expect(service_button(page, "digital-product-design")).to_have_attribute("aria-expanded", "true")
        settle(region(page, "services"))
        radio = filter_group(page).get_by_role("radio", name="Website Design (3)", exact=True)
        scroll_to(page, doc_top(radio) - HEADER_PX * 2)
        choose(radio, by_touch=True)
        expect(radio).to_be_checked()
        poll(page, lambda: shown_slugs(page) == SEQUENCES["website-design"], "tap filter")


def test_wf_phone_touch_showcase_swipe(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/pathway-transit", size=PHONE, reduced=True) as page:
        s = touch(page)
        sc = page.get_by_role("region", name="Showcase", exact=True)
        scroll_to(page, doc_top(sc) - HEADER_PX * 2)
        for k in (2, 3):
            rb = box(sc)
            swipe(s, rb["x"] + rb["w"] - GEOM_TOL_PX * 10, rb["y"] + rb["h"] / 3, -(SWIPE_PX * 2))
            reach(page, lambda k_=k: (showcase_at(page, k_, 3), k_), SHOWCASE_MS, f"swipe to screen {k}")
        expect(sc.get_by_role("button", name="Next screen", exact=True)).to_be_disabled()


def test_wf_project_enquiry_send(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email = new_email("send")
    desc = DESC + "\nSecond line for the committee."
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        watch_status(page)
        fill_enquiry(page, "Ada Probe", email, "website-design", "25k-50k", desc)
        click(send_button(page))
        ref = await_panel(page, "Ada")
        poll(page, lambda: norm(status(page).text_content()) == f"Enquiry {ref} sent.", "sent status")
        pairs = panel_pairs(page)
        assert pairs == {"Reference": ref, "Name": "Ada Probe", "Email": email, "Project type": "Website Design",
                         "Budget range": BUDGETS["25k-50k"], "Project description": desc}, pairs
        link = page.get_by_role("link", name="Download your brief (PDF)", exact=True)
        [row] = stored_for(app_url, email)
        assert row["reference"] == ref and row["description"] == desc and row["mail"] == "sent"
        assert re.fullmatch(r"/briefs/[0-9a-f]{32}\.pdf", target(link))
        click(page.get_by_role("button", name="Send another enquiry", exact=True))
        poll(page, lambda: field(page, "Name").evaluate("el => document.activeElement === el && el.value === ''"), "empty form, Name focused")
    msgs = mail_for(mail, email, 2)
    assert sorted(m.get("Subject") for m in msgs) == sorted([f"New enquiry {ref} · Website Design · {BUDGETS['25k-50k']}", f"Your enquiry {ref} to Sollis Studio"])


def test_wf_project_enquiry_correct_errors(browser: Browser, app_url: str, mail: Mailpit) -> None:
    email = new_email("correct")
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        fill(field(page, "Name"), "A")
        click(send_button(page))
        poll(page, lambda: page.get_by_role("link", name=MSG["name_len"], exact=True).count() == 1, "name range message")
        click(page.get_by_role("link", name=MSG["name_len"], exact=True))
        expect(field(page, "Name")).to_be_focused()
        fill_enquiry(page, "Ada Probe", email, "brand-identity", "under-10k", DESC)
        click(send_button(page))
        await_panel(page, "Ada")
    assert len(stored_for(app_url, email)) == 1
    assert len(mail_for(mail, email, 2)) == 2


def test_wf_project_enquiry_mail_down(browser: Browser, app_url: str, mail: Mailpit) -> None:
    assert MAIL_DOWN
    email = new_email("delay")
    with visit(browser, MAIL_DOWN + "/#contact", reduced=True) as page:
        watch_status(page)
        fill_enquiry(page, "Ada Probe", email, "not-sure", "over-50k", DESC)
        click(send_button(page))
        ref = await_panel(page, "Ada")
        expect(page.get_by_role("alert").filter(has_text=f"Your enquiry {ref} is saved, but we could not send the confirmation email. Maren will still reply within two working days.")).to_have_count(1)
        poll(page, lambda: norm(status(page).text_content()) == f"Enquiry {ref} saved.", "saved status")
    [row] = stored_for(MAIL_DOWN, email)
    assert row["reference"] == ref and row["mail"] == "not_sent"
    mail_absent(mail, email)


def test_wf_responsive_access_three_viewports(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for size in (DESKTOP, TABLET, PHONE):
        with visit(browser, app_url + "/", size=size, reduced=True) as page:
            layout(page)
            wide = size == DESKTOP
            expect(page.get_by_role("navigation", name="Main")).to_have_count(1 if wide else 0)
            expect(page.get_by_role("button", name="Menu", exact=True)).to_have_count(0 if wide else 1)
            tops = page.get_by_role("tablist", name="Statistics").get_by_role("tab").evaluate_all("els => els.map(e => e.getBoundingClientRect().top)")
            assert distinct(tops) == (1 if wide else 2), f"statistics tab rows at {size}"
            term = region(page, "contact").get_by_role("term").filter(has_text="Studio").first
            dl = term.evaluate("el => { let n = el; while (n && n.tagName !== 'DL') n = n.parentElement; const r = n.getBoundingClientRect(); return {y: r.top, b: r.bottom, x: r.left, r: r.right}; }")
            fb = box(form(page))
            if wide:
                assert abs(dl["y"] - fb["y"]) <= CONTACT_TOP_PX and (dl["r"] <= fb["x"] or fb["r"] <= dl["x"])
                h, plate = box(h1(page)), box(page.locator("[data-parallax]"))
                assert plate["x"] + plate["w"] / 2 > h["x"] + h["w"] / 2, "plate right of the intro heading"
                links = page.get_by_role("navigation", name="Footer").get_by_role("link").evaluate_all("els => els.map(e => e.getBoundingClientRect().top)")
                assert distinct(links) == 1, "footer links in one row"
            elif size == TABLET:
                assert dl["b"] <= fb["y"] + 0.5, "contact details above the form"
        with visit(browser, app_url + "/work/fieldwork-journal", size=size, reduced=True) as page:
            layout(page)
            nav = page.get_by_role("navigation", name="On this page")
            ov = page.get_by_role("heading", level=2, name="Overview", exact=True)
            if size == DESKTOP:
                n0 = box(nav)
                assert n0["r"] <= box(ov)["x"] + 0.5, "On this page beside the content on the left"
                scroll_to(page, doc_top(ov))
                advance(page, STEP_MS)
                assert abs(box(nav)["y"] - n0["y"]) > 0 or n0["y"] >= 0
                assert box(nav)["y"] >= 0 and box(nav)["b"] <= size[1], "On this page stays in view"
            else:
                assert box(nav)["b"] <= box(ov)["y"] + 0.5, "On this page above the sections"
        with visit(browser, app_url + "/privacy", size=size, reduced=True) as page:
            layout(page)
            expect(page).to_have_title(TITLE_PRIVACY)
            expect(h1(page)).to_have_text("Privacy")
            in_order(page.get_by_role("main").text_content() or "", ["Privacy", *PRIVACY_PARAS, "Back to Sollis Studio"], "privacy")
            assert target(page.get_by_role("main").get_by_role("link", name="Back to Sollis Studio", exact=True)) == "/"


def test_wf_responsive_access_same_state_three_widths(browser: Browser, app_url: str) -> None:
    restore(app_url)
    sid = "website-design"
    url = app_url + f"/?category={sid}&service=brand-identity"
    for size, cols in ((DESKTOP, COLUMNS[1280]), (TABLET, COLUMNS[768]), (PHONE, COLUMNS[375])):
        with visit(browser, url, size=size, reduced=True) as page:
            expect(filter_group(page).get_by_role("radio", name=radio_name(sid, 3), exact=True)).to_be_checked()
            expect(service_button(page, "brand-identity")).to_have_attribute("aria-expanded", "true")
            assert shown_slugs(page) == SEQUENCES[sid], f"shown work at {size}"
            lefts = page.locator("[data-project]").evaluate_all(
                "els => els.filter(e => e.getClientRects().length > 0 && !e.closest('[hidden]'))"
                ".map(e => e.getBoundingClientRect().left)")
            assert distinct(lefts) == cols, f"{cols} work columns at {size}: {lefts}"
            expect(page.get_by_role("navigation", name="Main")).to_have_count(1 if size == DESKTOP else 0)
            assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), f"no sideways overflow at {size}"


def test_wf_responsive_access_brief_download(browser: Browser, app_url: str) -> None:
    email = new_email("download")
    with visit(browser, app_url + "/#contact", reduced=True) as page:
        fill_enquiry(page, "Ada Probe", email, "digital-product-design", "10k-25k", DESC)
        click(send_button(page))
        ref = await_panel(page, "Ada")
        with page.expect_download() as dl:
            click(page.get_by_role("link", name="Download your brief (PDF)", exact=True))
        d = dl.value
        assert d.suggested_filename == f"{ref}-brief.pdf"
        data = Path(d.path()).read_bytes()
        assert pdf_pages(data) == 1 and strip_ws(f"Project brief {ref}") in strip_ws(pdf_text(data))
    assert [e["reference"] for e in stored_for(app_url, email)] == [ref]


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
FONT_PACKAGES = {"@fontsource/instrument-serif", "@fontsource/instrument-sans"}


def source_files(exts: tuple[str, ...]) -> Iterator[Path]:
    for p in APP.rglob("*"):
        if "node_modules" in p.parts or ".git" in p.parts or not p.is_file():
            continue
        if p.suffix in exts:
            yield p


def test_if_run_manifest(app_url: str) -> None:
    m = json.loads((APP / "run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m.get(k), str) and m[k].strip(), k
    assert httpx.get(app_url + "/api/health", timeout=HTTP_S).status_code == 200


def test_if_third_party_notices() -> None:
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert missing == [], f"packages missing from notices: {missing}"
    assert "Instrument Serif" in notes and "Instrument Sans" in notes


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if p.name not in FONT_PACKAGES and not licence_allowed(p.licence, ALLOWLIST)]
    assert bad == [], bad


def test_if_postgres_only() -> None:
    assert Postgres().tables(), "the app created its tables in Postgres"
    stores = [str(p) for p in source_files((".sqlite", ".sqlite3", ".db", ".rdb"))]
    assert stores == [], stores


def test_if_no_animation_library(browser: Browser, app_url: str) -> None:
    libs = {"gsap", "framer-motion", "motion", "animejs", "popmotion", "velocity-animate", "lottie-web", "three", "pixi.js"}
    assert [p.name for p in shipped_packages() if p.name in libs] == []
    for path in ["/", "/work/harbour-loom"]:
        with visit(browser, app_url + path, reduced=True) as page:
            assert page.evaluate("() => document.getElementsByTagName('canvas').length + document.getElementsByTagName('video').length") == 0


def test_if_colour_notation(browser: Browser, app_url: str) -> None:
    banned = re.compile(r"(?<![\w-])(hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|light-dark)\s*\(", re.I)
    sheets: list[str] = []
    with visit(browser, app_url + "/privacy", reduced=True) as page:
        page.on("response", lambda r: sheets.append(r.text()) if "text/css" in r.headers.get("content-type", "") else None)
        for path in ["/", "/work/harbour-loom", "/privacy"]:
            page.goto(app_url + path)
            sheets.extend(page.evaluate("() => Array.from(document.getElementsByTagName('style')).map(s => s.textContent)"))
    hits = [m.group(0) for css in sheets for m in banned.finditer(css)]
    assert hits == [], f"colour functions in stylesheets: {hits[:5]}"


def test_if_no_committed_credentials() -> None:
    secrets = [s for s in (KEY, urlparse(os.environ.get("DATABASE_URL", "")).password or "") if len(s) >= 6]
    hits = [str(p) for p in source_files((".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css"))
            if any(s in p.read_text(errors="ignore") for s in secrets)]
    assert hits == [], hits


FITS_JS = "() => document.documentElement.scrollWidth <= innerWidth + 1"


def from_page_end_by_footer(page: Page, name: str) -> None:
    scroll_to(page, page.evaluate("document.documentElement.scrollHeight"))
    click(page.get_by_role("navigation", name="Footer").get_by_role("link", name=name, exact=True))


def test_wf_brand_identity_service_phone_menu(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=PHONE, reduced=True) as page:
        touch(page)
        tap(page.get_by_role("button", name="Menu", exact=True))
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.count() == 1, "a tap opens the menu")
        expect(dialog.get_by_role("link", name="About", exact=True)).to_be_focused()
        h = dialog.element_handle()
        for key in ["Tab"] * 7 + ["Shift+Tab"] * 7:
            page.keyboard.press(key)
            assert page.evaluate("d => d.contains(document.activeElement)", h), f"{key} stays inside the menu"
        tap(dialog.get_by_role("link", name="Services", exact=True))
        poll(page, lambda: dialog.count() == 0, "a tap on Services closes the menu")
        assert_jump(page, h2(page, "services"), JUMP_MS, "menu Services by tap")
        btn = service_button(page, "brand-identity")
        tap(btn)
        expect(btn).to_have_attribute("aria-expanded", "true")
        expect(region(page, "services").get_by_text(SERVICES["brand-identity"]["summary"], exact=True)).to_be_visible()


def test_wf_website_service_tablet_menu_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", size=TABLET, reduced=True) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Menu")
        poll(page, lambda: dialog.count() == 1, "Enter opens the menu")
        expect(dialog.get_by_role("link", name="About", exact=True)).to_be_focused()
        h = dialog.element_handle()
        for key in ["Tab"] * 7 + ["Shift+Tab"] * 7:
            page.keyboard.press(key)
            assert page.evaluate("d => d.contains(document.activeElement)", h), f"{key} stays inside the menu"
        dialog.get_by_role("link", name="Services", exact=True).focus()
        page.keyboard.press("Enter")
        poll(page, lambda: dialog.count() == 0, "choosing Services closes the menu")
        assert_jump(page, h2(page, "services"), JUMP_MS, "menu Services")
        btn = service_button(page, "website-design")
        btn.focus()
        page.keyboard.press("Enter")
        expect(btn).to_have_attribute("aria-expanded", "true")


def test_wf_product_service_phone_evidence(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/?category=digital-product-design#work", size=PHONE, reduced=True) as page:
        assert shown_slugs(page) == SEQUENCES["digital-product-design"]
        assert page.evaluate(FITS_JS), "the filtered gallery fits 375 px"
        open_case_from_gallery(page, "ledgerline")
        assert_case_arrival(page, "ledgerline")
        assert page.evaluate(FITS_JS), "the Ledgerline case study fits 375 px without sideways scrolling"


def test_wf_case_study_phone_reading(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/harbour-loom", size=PHONE, reduced=True) as page:
        expect(page).to_have_title(f"{BY_SLUG['harbour-loom']['title']} | Sollis Studio")
        nav = page.get_by_role("navigation", name="On this page")
        assert box(nav)["b"] <= box(page.get_by_role("heading", level=2, name="Overview", exact=True))["y"] + 0.5
        assert page.evaluate(FITS_JS), "the case study fits 375 px without sideways scrolling"


def test_wf_project_sequence_phone(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/work/quarry-press?category=brand-identity", size=PHONE, reduced=True) as page:
        expect(page).to_have_title(f"{BY_SLUG['quarry-press']['title']} | Sollis Studio")
        assert page.evaluate(FITS_JS), "Quarry Press fits 375 px"
        tap(more_link(page, "Next"))
        poll(page, lambda: urlparse(page.url).path == "/work/tidewater-co-op", "Next to Tidewater Co-op")
        assert_case_arrival(page, "tidewater-co-op")
        assert page.evaluate(FITS_JS), "Tidewater Co-op fits 375 px"
        tap(more_link(page, "Previous"))
        poll(page, lambda: urlparse(page.url).path == "/work/quarry-press", "Previous back to Quarry Press")
        assert_case_arrival(page, "quarry-press")


def test_wf_motion_hover_reduced_footer_jump(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, app_url + "/", reduced=True, record=True) as page:
        from_page_end_by_footer(page, "Work")
        clear_recs(page)
        assert_jump(page, h2(page, "work"), JUMP_MS, "reduced-motion footer Work")
        advance(page, FRAME_MS)
        assert timed(recs(page, region(page, "work"))) == [], "reduced motion: no timed motion on the work"


def test_wf_project_enquiry_reduced_footer(browser: Browser, app_url: str, mail: Mailpit) -> None:
    restore(app_url)
    email = new_email("footer")
    with visit(browser, app_url + "/", reduced=True) as page:
        from_page_end_by_footer(page, "Contact")
        assert_jump(page, h2(page, "contact"), JUMP_MS, "reduced-motion footer Contact")
        fill_enquiry(page, "Ada Probe", email, "brand-identity", "10k-25k", DESC)
        send_button(page).focus()
        page.keyboard.press("Enter")
        await_panel(page, "Ada")
