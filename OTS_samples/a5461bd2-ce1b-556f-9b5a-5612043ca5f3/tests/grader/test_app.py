from __future__ import annotations

import json
import math
import os
import re
import struct
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    animations,
    axe,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    scene_frames,
    select,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    unique,
    until,
)


W_DESKTOP = 1280
H_DESKTOP = 800
W_TABLET = 768
H_TABLET = 1024
W_PHONE = 375
H_PHONE = 812
HEADER_PX = 64
CLEAR_TOP = 72
DESCENT_MS = 900
TURN_MS = 450
FLIGHT_MS = 700
EMBLEM_DEG_PER_S = 15
EMBLEM_TURN_MS = 24000
WORLD_STEP_DEG = 45
MAX_YAW = 315.0
DRAG_FACTOR = 0.1875
DRAG_SELECT_PX = 80
SWIPE_PX = 60
PAGE_SIZE = 6
ENQUIRY_LIMIT = 3
WINDOW_S = 600
BODY_MAX = 16384
NAME_MAX = 80
BUSINESS_MAX = 120
DESC_MIN = 30
DESC_MAX = 1200
INTAKE_TIMEOUT_MS = 5000
MIN_TARGET = 44
MODEL_MIN_VERTICES = 5000
MODELS_MAX_BYTES = 4000000
SVG_MIN_W = 1200
SVG_MIN_H = 800
STAGE_BAND = 0.6
WORLD_COUNT = 8
PROJECT_COUNT = 12
PRICE_COUNT = 14

FRAME_MS = 50
MENU_MS = 200
SLIDE_MS = 240
TURN_STEP_MS = 50
EMBLEM_STEP_MS = 4000
EMBLEM_TOL_DEG = 0.6
SCROLL_TOL_PX = 1.5
HTTP_TIMEOUT = 30
MODE_DEADLINE_S = 30
POLL_S = 10
TAB_LIMIT = 80
GLB_JSON_CHUNK = 0x4E4F534A

PROBE_UNKNOWN = "atlantis"
PROBE_INTAKE_REF = "IN-PROBE-7731"
PROBE_BAD_EMAIL = "anika@pepperleaf"
PROBE_FAKE_REFERENCE = "VO-999999"
PROBE_FAKE_CREATED = "2001-01-01T00:00:00Z"
PROBE_SHORT_SWIPE = SWIPE_PX // 2
PROBE_DRAG_SHORT = DRAG_SELECT_PX * 4 // 5
PROBE_DRAG_LONG = DRAG_SELECT_PX + DRAG_SELECT_PX // 4
PROBE_DRAG_HUGE = DRAG_SELECT_PX * 5
PROBE_DRAG_SMALL = DRAG_SELECT_PX // 2
STEP_YAW = float(WORLD_STEP_DEG)
LAST_STEP_YAW = MAX_YAW - STEP_YAW

INTAKE_PATH = "/v1/intake/enquiries"
TITLE_SUFFIX = " | Vellum Orbit Studio"

EX_NAME = "Anika Joseph"
EX_BUSINESS = "Pepperleaf Teas"
EX_DESCRIPTION = "A range of six tea tins for a new Kochi tea label."

INTAKE_FAIL_ALERT = "We could not hand your enquiry to the studio's intake service. Your answers are kept. Try again in a moment."


INDUSTRIES = {
    "finance": "Finance and professional services",
    "food": "Food, coffee and hospitality",
    "architecture": "Architecture and real estate",
    "technology": "Technology and software",
    "lifestyle": "Lifestyle and personal care",
    "film": "Film and creative production",
    "consumer": "Consumer products",
    "experimental": "Experimental",
}
SERVICES = [
    ("brand-identity", "Brand identity"),
    ("framer-websites", "Framer websites"),
    ("shopify-stores", "Shopify stores"),
    ("packaging", "Packaging"),
    ("business-applications", "Business applications"),
    ("social-content", "Social and content"),
]
SERVICE_NAME = dict(SERVICES)
SERVICE_ORDER = [s for s, _ in SERVICES]

PROJECTS: list[dict[str, Any]] = [
    {"slug": "ledgerwick", "name": "Ledgerwick Advisory", "industry": "finance", "services": ["brand-identity", "framer-websites"], "ground": "0F1B2D", "ink": "F2E9D8", "accent": "C49A5A", "face": "Libre Caslon Display"},
    {"slug": "monsoon-crate", "name": "Monsoon Crate Coffee", "industry": "food", "services": ["brand-identity", "packaging", "shopify-stores"], "ground": "1E2B22", "ink": "F4E6D0", "accent": "D08A3E", "face": "Fraunces"},
    {"slug": "basalt-beam", "name": "Basalt & Beam", "industry": "architecture", "services": ["brand-identity", "framer-websites"], "ground": "2A2A2C", "ink": "EDEBE6", "accent": "E3B23C", "face": "Archivo"},
    {"slug": "quillstack", "name": "Quillstack", "industry": "technology", "services": ["business-applications", "framer-websites"], "ground": "120F2A", "ink": "E7E4FF", "accent": "8C7CFF", "face": "JetBrains Mono"},
    {"slug": "neem-nectar", "name": "Neem & Nectar", "industry": "lifestyle", "services": ["packaging", "shopify-stores", "social-content"], "ground": "F3EEDC", "ink": "1F3A26", "accent": "C98A1B", "face": "DM Serif Display"},
    {"slug": "reelhouse", "name": "Reelhouse Pictures", "industry": "film", "services": ["brand-identity", "social-content"], "ground": "0B0B0B", "ink": "F5D9A8", "accent": "E4572E", "face": "Bebas Neue"},
    {"slug": "tiffin-theory", "name": "Tiffin Theory", "industry": "consumer", "services": ["packaging", "shopify-stores"], "ground": "E9EDEF", "ink": "1A1F24", "accent": "E0A100", "face": "Rubik"},
    {"slug": "static-bloom", "name": "Static Bloom", "industry": "experimental", "services": ["brand-identity", "social-content"], "ground": "2B0F2A", "ink": "FFE3F1", "accent": "FF4FA3", "face": "Syne"},
    {"slug": "copperline", "name": "Copperline Tax Partners", "industry": "finance", "services": ["business-applications"], "ground": "1C2321", "ink": "EFE7D7", "accent": "B87333", "face": "Libre Caslon Display"},
    {"slug": "saltpan-kitchen", "name": "Saltpan Kitchen", "industry": "food", "services": ["social-content", "brand-identity"], "ground": "F1ECE2", "ink": "23303A", "accent": "2F7F8F", "face": "DM Serif Display"},
    {"slug": "courtyard-homes", "name": "Courtyard Homes", "industry": "architecture", "services": ["framer-websites"], "ground": "E8E1D5", "ink": "2B2622", "accent": "9A5B34", "face": "Archivo"},
    {"slug": "relaywise", "name": "Relaywise", "industry": "technology", "services": ["brand-identity", "business-applications"], "ground": "0E1A1F", "ink": "E2F1F0", "accent": "3FD0B6", "face": "Rubik"},
]
WORLDS = PROJECTS[:8]
WORLD_IDS = ["ledgerwick", "monsoon-crate", "basalt-beam", "quillstack", "neem-nectar", "reelhouse", "tiffin-theory", "static-bloom"]

WORLD_COPY = {
    "ledgerwick": {"summary": "A quiet, ledger-ruled identity for a Kochi advisory firm that wanted to feel steady rather than corporate.", "overview": "Ledgerwick Advisory helps family businesses in Kerala with accounts, tax and succession planning.", "decisions": ["Ruled lines as structure", "Brass, used sparingly", "A classical voice"]},
    "monsoon-crate": {"summary": "A rain-washed identity, packaging range and Shopify store for a small-batch coffee roaster in the Western Ghats.", "overview": "Monsoon Crate roasts beans from three estates near Chikmagalur and ships them in small crates across India.", "decisions": ["Rain as a pattern", "Labels that read like field notes", "One store, three estates"]},
    "basalt-beam": {"summary": "A sturdy, grid-built identity and portfolio website for a two-partner architecture practice.", "overview": "Basalt & Beam is a two-partner practice that designs homes and small public buildings in laterite and timber.", "decisions": ["The grid is the logo", "Drawings before photographs", "One ochre line"]},
    "quillstack": {"summary": "A precise, code-born identity and product design for a start-up that turns field notes into reports.", "overview": "Quillstack builds a mobile and web application that lets field teams write short notes and turns them into weekly reports.", "decisions": ["Monospace as voice", "A violet signal", "Flows before screens"]},
    "neem-nectar": {"summary": "A botanical packaging range, Shopify store and social kit for a small-batch skincare label.", "overview": "Neem & Nectar makes soaps, balms and oils from neem, honey and coconut in small batches.", "decisions": ["Ingredients on the front", "Line drawings, not photographs", "A kit the founder can run"]},
    "reelhouse": {"summary": "A bold, poster-loud identity and content system for an independent film production house.", "overview": "Reelhouse Pictures produces documentaries and short films in Malayalam and English.", "decisions": ["Title-card typography", "Red means release", "A frame for every format"]},
    "tiffin-theory": {"summary": "A bright, stackable packaging system and Shopify store for a brand of steel lunch boxes.", "overview": "Tiffin Theory makes stackable steel lunch boxes with leak-proof lids.", "decisions": ["Tiers as bands", "Rounded and friendly", "Compare, then buy"]},
    "static-bloom": {"summary": "A loud, glitch-flower identity for an experimental music and visual arts collective.", "overview": "Static Bloom is a collective that runs late-night sound and light events in Kochi.", "decisions": ["A mark that mutates", "Pink on plum", "Wide type, short words"]},
}
DELIVERABLES = {
    "ledgerwick": ["Logo and wordmark", "Stationery and report templates", "Brand guidelines book", "Framer website, six pages"],
    "monsoon-crate": ["Logo and wordmark", "Packaging range of six packs", "Shopify store with subscription page", "Brand guidelines book"],
    "basalt-beam": ["Logo and mark", "Drawing-sheet and presentation templates", "Framer portfolio website", "Signage guidelines"],
    "quillstack": ["Logo and wordmark", "Application flows and wireframes", "Application interface design", "Framer marketing website"],
    "neem-nectar": ["Packaging range of eight products", "Shopify store", "Social template kit", "Illustration library"],
    "reelhouse": ["Logo and title card", "Poster templates", "Social and content system", "Trailer end-card designs"],
    "tiffin-theory": ["Packaging sleeves for four sizes", "Shipping carton design", "Shopify store", "Product photography direction"],
    "static-bloom": ["Generative logo system", "Event poster templates", "Social and content kit", "Stage visual loops"],
    "copperline": ["Portal flows and wireframes", "Portal interface design", "Component library"],
    "saltpan-kitchen": ["Logo and mark", "Menu templates", "Social and content series"],
    "courtyard-homes": ["Framer website, five pages", "Home listing template"],
    "relaywise": ["Logo and wordmark", "Brand guidelines", "Dispatcher interface design"],
}
BRIEFS = {
    "ledgerwick": "Give a forty-year-old advisory firm a brand that feels steady and current, and a website that explains its services in plain language.",
    "monsoon-crate": "Launch a coffee brand that carries the monsoon, with packs for six coffees and an online store.",
    "basalt-beam": "Give a two-partner practice an identity as honest as its materials and a portfolio that shows drawings first.",
    "quillstack": "Name the product's voice, map how field notes become reports and launch a site that explains it in four screens.",
    "neem-nectar": "Design a range of eight skincare packs, a Shopify store and a social kit the founder can run alone.",
    "reelhouse": "Create a brand that holds its own on a festival poster and a phone screen, plus a system for release content.",
    "tiffin-theory": "Make steel lunch boxes stand out on a shelf of plain steel and explain their tiers at a glance.",
    "static-bloom": "Give an experimental collective a brand that can change each season without losing itself.",
    "copperline": "Design a client portal where small businesses upload invoices and see where their tax return stands.",
    "saltpan-kitchen": "Refresh a coastal seafood kitchen's identity and give it a weekly content rhythm.",
    "courtyard-homes": "Build a website for a builder of courtyard homes that lets buyers walk a plan before visiting.",
    "relaywise": "Name and brand a delivery-routing start-up and design the dispatcher's main screens.",
}
CAPTIONS = {
    "ledgerwick": ["Wordmark on ruled ledger paper", "Letterhead and report cover", "Services page on the Framer website", "Brass accent on a signature line"],
    "monsoon-crate": ["Six packs in the rain-streak pattern", "Estate label with altitude and roast date", "Shopify product page for a dark roast", "Delivery crate with stamped logo"],
    "basalt-beam": ["Mark drawn on the construction grid", "Drawing-sheet title block", "Portfolio page opening on a plan", "Site signage in laterite and brass"],
    "quillstack": ["Monospaced wordmark and signal colour", "Field note screen on a phone", "Weekly report on desktop", "Framer marketing site hero"],
    "neem-nectar": ["Eight packs on a cream ground", "Neem leaf line drawing", "Ingredient-first product page", "Weekly post from the social kit"],
    "reelhouse": ["Title card in condensed type", "Festival poster template", "Release story on a phone", "Trailer end card"],
    "tiffin-theory": ["Four sleeves with tier bands", "Shipping carton", "Size comparison table", "Stacked boxes on a shelf"],
    "static-bloom": ["A season of generated blooms", "Event poster in pink on plum", "Event story sequence", "Stage visual still"],
    "copperline": ["Return checklist on desktop", "Invoice upload on a phone", "Status colours", "Portal component sheet"],
    "saltpan-kitchen": ["Salt-crystal mark", "Menu board", "Day's catch post", "Takeaway bag"],
    "courtyard-homes": ["Home page with courtyard photograph", "Plan with rooms marked", "Home listing on a phone", "Enquiry section"],
    "relaywise": ["Relay-baton mark", "Dispatcher route board", "Driver view on a phone", "Brand colour sheet"],
}
SERVICE_COPY = {
    "brand-identity": {"purpose": "A brand identity gives your business one recognisable look and voice, from the logo to the way you write an invoice.", "deliverables": ["Logo and wordmark", "Colour palette and type pairing", "Brand guidelines book", "Stationery templates"], "steps": [("Discovery", "We talk with the founders and a few customers to learn what the business stands for."), ("Strategy", "We agree on positioning and a short list of words the brand must feel like."), ("Design", "We present two routes, then develop the chosen one into a full system."), ("Guidelines", "We hand over files and a guidelines book so anyone can use the brand well.")]},
    "framer-websites": {"purpose": "A Framer website is fast to launch and easy for you to edit, with designed pages rather than a template.", "deliverables": ["Site map and page wireframes", "Designed pages for phone and desktop", "Built Framer site with editable content", "Launch and handover session"], "steps": [("Map", "We list every page and what each must help a visitor do."), ("Design", "We design the pages for phone and desktop in your brand."), ("Build", "We build the site in Framer and connect your domain."), ("Launch", "We launch, then walk you through editing your own pages.")]},
    "shopify-stores": {"purpose": "A Shopify store designed around how your customers actually choose and buy your products.", "deliverables": ["Store structure and product page design", "Theme setup or custom theme", "Payment, shipping and tax settings", "Training for your team"], "steps": [("Audit", "We review your products, prices and how orders reach you today."), ("Structure", "We plan collections, filters and product pages."), ("Build", "We design and build the store and load your first products."), ("Train", "We train your team to add products and handle orders.")]},
    "packaging": {"purpose": "Packaging that stands out on a shelf, explains the product and prints well at your printer.", "deliverables": ["Pack structure and dieline", "Front, back and side artwork", "Print-ready files", "Printer proof check"], "steps": [("Shelf study", "We look at where your product sits and what surrounds it."), ("Concepts", "We present three concepts on mock-up packs."), ("Artwork", "We complete the artwork for every face and every variant."), ("Print check", "We check the printer's proof before the run.")]},
    "business-applications": {"purpose": "Clear, usable screens for the software your team or customers use every day.", "deliverables": ["User flows and wireframes", "Interface design for phone and desktop", "Component library", "Developer handover"], "steps": [("Research", "We watch how people do the task today."), ("Flows", "We map every path through the application."), ("Interface", "We design the screens and their states."), ("Handover", "We hand over the design system and answer your developers' questions.")]},
    "social-content": {"purpose": "Templates and monthly content that keep your social channels consistent without a full-time designer.", "deliverables": ["Template kit for posts and stories", "Monthly content calendar", "Designed posts each month", "Usage guide"], "steps": [("Audit", "We review your channels and what your audience responds to."), ("Kit", "We design templates your team can fill."), ("Calendar", "We plan each month's posts with you."), ("Produce", "We design the month's posts and send them ready to publish.")]},
}
PRICES = [
    ("logo-wordmark", "brand-identity", "Logo and wordmark", "fixed", "₹45,000", "2 to 3 weeks", "3 revision rounds", ["Two initial logo routes", "Final logo in colour and one-colour versions", "Files for print and screen"]),
    ("identity-system", "brand-identity", "Brand identity system", "custom", "From ₹1,80,000", "6 to 8 weeks", "3 revision rounds", ["Logo, colour and type system", "Brand guidelines book", "Stationery and social templates"]),
    ("brand-guidelines", "brand-identity", "Brand guidelines book", "fixed", "₹60,000", "2 weeks", "2 revision rounds", ["Up to 40 pages of guidance", "Logo, colour and type rules", "Editable source file"]),
    ("framer-landing", "framer-websites", "Framer landing page", "fixed", "₹55,000", "2 weeks", "2 revision rounds", ["One designed page for phone and desktop", "Built in Framer with editable text", "Contact form and domain setup"]),
    ("framer-site", "framer-websites", "Framer website, up to 8 pages", "fixed", "₹1,40,000", "4 to 5 weeks", "2 revision rounds", ["Up to 8 designed pages", "Built in Framer with editable content", "One editing training session"]),
    ("shopify-theme", "shopify-stores", "Shopify theme setup", "fixed", "₹85,000", "3 weeks", "2 revision rounds", ["Theme chosen and styled to your brand", "Up to 30 products loaded", "Payment and shipping settings"]),
    ("shopify-custom", "shopify-stores", "Custom Shopify store", "custom", "From ₹2,50,000", "8 to 10 weeks", "3 revision rounds", ["Custom theme designed for your products", "Collections and filters planned with you", "Team training and 30 days of support"]),
    ("pack-single", "packaging", "Single pack design", "fixed", "₹38,000", "2 to 3 weeks", "3 revision rounds", ["One pack structure and dieline", "Artwork for every face", "Print-ready files"]),
    ("pack-range", "packaging", "Packaging range", "custom", "From ₹1,20,000", "5 to 7 weeks", "3 revision rounds", ["Shared system for every pack in the range", "Artwork for each variant", "Printer proof checks"]),
    ("app-flows", "business-applications", "App flows and wireframes", "fixed", "₹70,000", "3 weeks", "2 revision rounds", ["Up to 12 user flows", "Wireframes for phone and desktop", "A clickable prototype"]),
    ("app-design", "business-applications", "Business application design", "custom", "From ₹3,00,000", "10 to 12 weeks", "3 revision rounds", ["Interface design for every screen and state", "Component library", "Developer handover sessions"]),
    ("social-kit", "social-content", "Social template kit", "fixed", "₹28,000", "1 to 2 weeks", "2 revision rounds", ["12 post and story templates", "Editable files for your team", "Usage guide"]),
    ("content-month", "social-content", "Monthly content design", "fixed", "₹42,000 a month", "Every month", "1 revision round", ["Up to 16 designed posts", "Monthly content calendar", "One planning call"]),
    ("campaign-content", "social-content", "Campaign content", "custom", "From ₹90,000", "3 to 4 weeks", "2 revision rounds", ["Campaign concept and key visual", "Posts, stories and banners", "Formats for every channel you use"]),
]
TYPE_BADGE = {"fixed": "Fixed price", "custom": "Custom quote"}
PAYMENT_LINE = {"fixed": "Payment: half to start, half on handover.", "custom": "Quoted after a 30-minute call."}
QUESTIONS = [
    ("services", "Which services does the studio offer?", "We offer six services: brand identity, Framer websites, Shopify stores, packaging, business applications, and social and content. Many projects combine two or three of them."),
    ("timelines", "How long does a project take?", "Most projects take between two and twelve weeks. Each item on the price list shows its delivery estimate, from one to two weeks for a social template kit to ten to twelve weeks for a business application."),
    ("pricing", "How are prices set?", "All prices on this site are illustrative."),
    ("revisions", "How many revision rounds are included?", "Each item on the price list states its revision rounds, usually two or three. A round is one set of combined feedback from you, which we then apply in full."),
    ("framer", "Why do you build websites in Framer?", "Framer lets us design and build in one place, launch quickly and hand you a site you can edit yourself without code."),
    ("shopify", "Do you build Shopify stores from scratch?", "Yes. We set up and style an existing theme for smaller stores, or design a custom store when your products need it."),
    ("ownership", "Who owns the final files?", "Once the final payment is made, you own the final files and the right to use them. We keep the right to show the work in our portfolio."),
    ("collaboration", "How do we work together?", "We work in short rounds with one call a week and a shared folder for files. You always talk to one of the two founders."),
]
PRINCIPLES = [
    ("Proportion", "We measure before we decorate. Good proportion is the reason a page feels calm before anyone reads it."),
    ("Patience", "We take six projects a season so each one gets time to settle. The second idea is usually better than the first."),
    ("Craft", "We check the printer's proof, the phone screen and the invoice template with the same care as the logo."),
    ("Distinction", "Every brand we make should look like its business and no one else's, which is why our eight worlds look nothing alike."),
]
PEOPLE = [
    ("Meera Varghese", "Co-founder, creative director", "Leads identity and art direction, and still draws every first sketch by hand."),
    ("Arjun Pillai", "Co-founder, digital lead", "Leads websites, stores and applications, from first flow to launch."),
    ("Tara Menon", "Packaging and print designer", "Takes packs from concept to the printer's proof."),
    ("Kabir Rao", "Content and motion designer", "Designs monthly content and the motion in our brand worlds."),
]
STAGES = [
    ("Listen", "A first call and a short questionnaire about your business."),
    ("Map", "We agree on scope, price, timeline and revision rounds in writing."),
    ("Make", "We design in short rounds and share progress every week."),
    ("Refine", "We apply your feedback in the agreed revision rounds."),
    ("Hand over", "You receive every final file and a walkthrough of how to use them."),
]
BUDGETS = [
    ("under-50k", "Under ₹50,000"),
    ("50k-150k", "₹50,000 to ₹1,50,000"),
    ("150k-500k", "₹1,50,000 to ₹5,00,000"),
    ("above-500k", "Above ₹5,00,000"),
    ("not-sure", "Not sure yet"),
]
BUDGET_LABEL = dict(BUDGETS)
MAIN_LINKS = ["Work", "Services", "Studio", "Pricing", "Contact"]
FONT_FAMILIES = ["Bodoni Moda", "Figtree", "Libre Caslon Display", "Fraunces", "Archivo", "JetBrains Mono", "DM Serif Display", "Bebas Neue", "Rubik", "Syne"]

SITE_MAP = [
    ("/", "Vellum Orbit Studio | Eight brand worlds"),
    ("/work", "Selected work | Vellum Orbit Studio"),
    ("/services", "Services | Vellum Orbit Studio"),
    ("/services/packaging", "Services | Vellum Orbit Studio"),
    ("/studio", "The studio | Vellum Orbit Studio"),
    ("/pricing", "Price list | Vellum Orbit Studio"),
    ("/faq", "Questions and answers | Vellum Orbit Studio"),
    ("/contact", "Start a project | Vellum Orbit Studio"),
] + [(f"/worlds/{w['slug']}", w["name"] + TITLE_SUFFIX) for w in WORLDS] + [(f"/work/{p['slug']}", p["name"] + TITLE_SUFFIX) for p in PROJECTS]
NOT_FOUND = [
    (f"/worlds/{PROBE_UNKNOWN}", "This world does not exist.", "Back to the worlds", "/"),
    (f"/work/{PROBE_UNKNOWN}", "This project does not exist.", "All work", "/work"),
    (f"/services/{PROBE_UNKNOWN}", "This service does not exist.", "All services", "/services"),
    (f"/{PROBE_UNKNOWN}", "This page does not exist.", "Back to Vellum Orbit Studio", "/"),
]


def project(slug: str) -> dict[str, Any]:
    return next(p for p in PROJECTS if p["slug"] == slug)


def world_index(slug: str) -> int:
    return WORLD_IDS.index(slug) + 1


def world_line(k: int) -> str:
    w = WORLDS[k - 1]
    return f"World {k} of 8: {w['name']}, {INDUSTRIES[w['industry']]}"


def numeral(k: int) -> str:
    return f"0{k} / 08"


def yaw_text(k: int) -> str:
    return f"{(k - 1) * WORLD_STEP_DEG:.1f}"


def meta_line(p: dict[str, Any]) -> str:
    return f"{INDUSTRIES[p['industry']]} · " + ", ".join(SERVICE_NAME[s] for s in SERVICE_ORDER if s in p["services"])


def rgb(hexv: str) -> str:
    return f"rgb({int(hexv[0:2], 16)}, {int(hexv[2:4], 16)}, {int(hexv[4:6], 16)})"


def btn(scope: Any, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def lnk(scope: Any, name: str) -> Locator:
    return scope.get_by_role("link", name=name, exact=True)


def heading(scope: Any, name: str, level: int) -> Locator:
    return scope.get_by_role("heading", name=name, level=level, exact=True)


def textbox(page: Page, name: str) -> Locator:
    return page.get_by_role("textbox", name=name, exact=True)


def stage(page: Page) -> Locator:
    return page.locator("[data-stage]")


def sattr(page: Page, name: str) -> str:
    return stage(page).get_attribute(f"data-{name}") or ""


def yaw(page: Page) -> float:
    return float(sattr(page, "yaw"))


def rail(page: Page) -> Locator:
    return page.get_by_role("navigation", name="World rail", exact=True)


def rail_btn(page: Page, name: str) -> Locator:
    return btn(rail(page), name)


def announcer(page: Page) -> Locator:
    return page.get_by_role("status", name="World announcer", exact=True)


def texts(loc: Locator) -> list[str]:
    return loc.evaluate_all("els => els.map(e => e.textContent.replace(/\\s+/g, ' ').trim())")


def href_path(loc: Locator) -> str:
    return urlparse(loc.get_attribute("href") or "").path


def href_query(loc: Locator) -> dict[str, list[str]]:
    return parse_qs(urlparse(loc.get_attribute("href") or "").query)


def live_url(page: Page) -> str:
    return page.evaluate("() => location.href")


def url_query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(live_url(page)).query)


def url_path(page: Page) -> str:
    return urlparse(live_url(page)).path


def wait_for(predicate: Any, message: str, seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
    pytest.fail(message)


STAGE_ATTR_JS = "([name, value]) => { const s = document.querySelector('[data-stage]'); return !!s && s.getAttribute(name) === value; }"


def wait_attr(page: Page, name: str, value: str, seconds: float = MODE_DEADLINE_S) -> None:
    until(page, STAGE_ATTR_JS, [f"data-{name}", value], seconds=seconds)


@contextmanager
def opened(browser: Browser, url: str, *, width: int = W_DESKTOP, height: int = H_DESKTOP, mode: str | None = None, **kw: Any) -> Iterator[Page]:
    with open_app(browser, url, **kw) as page:
        page.set_viewport_size({"width": width, "height": height})
        page.reload()
        if mode:
            wait_attr(page, "mode", mode)
        yield page


SCROLL_JS = """async (y) => {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const t = Math.max(0, Math.min(y, max));
  await new Promise((resolve) => {
    if (Math.abs(window.scrollY - t) < 0.5) { resolve(); return; }
    window.addEventListener('scroll', () => resolve(), { once: true });
    window.scrollTo({ top: t, behavior: 'instant' });
  });
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  }
}"""


def scroll_to(page: Page, y: float) -> None:
    page.evaluate(SCROLL_JS, y)


def geometry(page: Page) -> dict[str, float]:
    return page.evaluate(
        "() => { const s = document.querySelector('[data-section=\"worlds\"]'); const r = s.getBoundingClientRect();"
        " const b = document.querySelector('[data-section=\"studio-in-brief\"]');"
        " return { top: r.top + window.scrollY, vh: window.innerHeight, height: r.height,"
        " brief: b ? b.getBoundingClientRect().top + window.scrollY : 0 }; }"
    )


def world_y(g: dict[str, float], k: int) -> float:
    return g["top"] + (k - 1) * g["vh"]


def scroll_y(page: Page) -> float:
    return page.evaluate("() => window.scrollY")


def assert_scroll_at(page: Page, y: float, what: str) -> None:
    wait_for(lambda: abs(scroll_y(page) - y) <= SCROLL_TOL_PX, f"{what}: expected the page at scroll position {y}, got {scroll_y(page)}")


def to_ring(page: Page) -> dict[str, float]:
    g = geometry(page)
    scroll_to(page, world_y(g, 1))
    return g


def scroll_world(page: Page) -> str:
    g = geometry(page)
    k = max(0, min(WORLD_COUNT - 1, math.floor((scroll_y(page) - g["top"]) / g["vh"] + 0.5))) + 1
    return WORLD_IDS[k - 1]


def assert_clear(page: Page, loc: Locator, what: str) -> None:
    box = loc.bounding_box()
    vh = page.evaluate("() => window.innerHeight")
    assert box is not None, f"{what} has no box"
    assert box["y"] >= CLEAR_TOP - SCROLL_TOL_PX, f"{what} top {box['y']} is under the header (clear zone starts at {CLEAR_TOP})"
    if box["height"] <= vh - CLEAR_TOP:
        assert box["y"] + box["height"] <= vh + SCROLL_TOL_PX, f"{what} bottom is below the viewport"


def to_step_one(page: Page, service: str) -> None:
    first = page.get_by_role("heading", name=re.compile(r"^Step [12] of 4: "), level=2)
    expect(first).to_be_visible()
    if (first.text_content() or "").startswith("Step 2"):
        expect(page.get_by_role("radio", name=service, exact=True)).to_be_checked()
        click(btn(page, "Back"))
    expect(heading(page, "Step 1 of 4: About you", 2)).to_be_visible()


CLEAR_SCROLL_JS = "(e, top) => { const r = e.getBoundingClientRect(); if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'instant' }); }"


SETTLED_JS = "d => Promise.all(d.getAnimations({ subtree: true }).filter((a) => Number.isFinite(a.effect && a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => null))).then(() => true)"


def settle_menu(page: Page, ms: float = MENU_MS + FRAME_MS) -> None:
    advance(page, ms)
    page.get_by_role("dialog", name="Menu", exact=True).evaluate(SETTLED_JS)


def settle_viewer(page: Page) -> None:
    advance(page, SLIDE_MS + FRAME_MS)
    page.get_by_role("dialog", name="Image viewer", exact=True).evaluate(SETTLED_JS)


ATTACHED_JS = "e => { const c = e.cloneNode(true); c.querySelectorAll('button').forEach((b) => b.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); }"


def attached(page: Page) -> Locator:
    return page.get_by_text(re.compile(r"^\s*Enquiring about: "))


def expect_attached(page: Page, item: str) -> None:
    line = attached(page)
    expect(line).to_have_count(1)
    expect(line).to_be_visible()
    assert line.evaluate(ATTACHED_JS) == f"Enquiring about: {item}", f"attached line reads {line.evaluate(ATTACHED_JS)!r}"


def click_clear(loc: Locator) -> None:
    expect(loc).to_be_visible()
    loc.evaluate(CLEAR_SCROLL_JS, CLEAR_TOP)
    click(loc)


def focused(loc: Locator) -> bool:
    return bool(loc.evaluate("e => e === document.activeElement"))


def tab_to(page: Page, loc: Locator, key: str = "Tab") -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press(key)
        if loc.count() and focused(loc):
            return
    pytest.fail(f"{key} never reached the expected control")


def focus_ring_ok(page: Page) -> bool:
    style_, width = page.evaluate("() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth) || 0]; }")
    return style_ != "none" and width >= 2


FREE_POINT_JS = """(stage) => {
  const r = stage.getBoundingClientRect();
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
  const free = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && stage.contains(el) && !el.closest('button, a, nav'); };
  const ys = [0.35, 0.3, 0.4, 0.25, 0.45, 0.5, 0.2, 0.55, 0.6, 0.15, 0.65, 0.1, 0.7, 0.75, 0.8];
  const xs = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7];
  for (const m of [44, 32, 20]) {  // infra: margin from any control; Chromium touch adjustment moves a touch onto a control this close
    const around = [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m], [m, m], [m, -m], [-m, m], [-m, -m]];
    for (const fy of ys) {
      for (const fx of xs) {
        const x = r.left + r.width * fx, y = top + (bottom - top) * fy;
        if (around.every(([dx, dy]) => free(x + dx, y + dy))) return [x, y];
      }
    }
  }
  return null;
}"""


def drag_point(page: Page) -> tuple[float, float]:
    point = stage(page).evaluate(FREE_POINT_JS)
    assert point, "No free stage area outside buttons, links and the rail to press on"
    return float(point[0]), float(point[1])


def touch_on(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    return cdp


def swipe(page: Page, x: float, y: float, dx: float, dy: float = 0) -> None:
    cdp = touch_on(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 8, "y": y + dy * i / 8}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


TOUCH_STEPS = 15
TOUCH_STEP_MS = 25
TOUCH_SPAN = 0.55
TOUCH_TOP = 0.2
SETTLE_S = 0.3
_TOUCH_END: dict[int, float] = {}
LOW_POINT_JS = """(top) => {
  const stage = document.querySelector('[data-stage]');
  if (!stage) return null;
  const r = stage.getBoundingClientRect(), vh = window.innerHeight;
  const free = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && stage.contains(el) && !el.closest('button, a, nav, input, select, textarea'); };
  for (const m of [44, 32, 20]) {  // infra: margin from any control (touch adjustment, as in FREE_POINT_JS)
    const around = [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m], [m, m], [m, -m], [-m, m], [-m, -m]];
    for (const fy of [0.75, 0.72, 0.69, 0.66, 0.63, 0.6]) {
      for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7, 0.45, 0.55, 0.35, 0.65]) {
        const x = r.left + r.width * fx, y = vh * fy;
        if (y - vh * top < vh * 0.3) continue;
        if (around.every(([dx, dy]) => free(x + dx, y + dy))) return [x, y];
      }
    }
  }
  return null;
}"""


def touch_scroll(page: Page, x: float, y: float, distance: float) -> None:
    cdp = touch_on(page)
    vh = page.evaluate("() => window.innerHeight")
    span = vh * TOUCH_SPAN
    left = max(0.0, distance)
    while left > 0.5:
        point = page.evaluate(LOW_POINT_JS, TOUCH_TOP)
        assert point, "No free stage point outside controls in the lower part of the viewport to start a swipe on"
        x, y0 = float(point[0]), float(point[1])
        d = min(span, left, y0 - vh * TOUCH_TOP)
        while time.time() < _TOUCH_END.get(id(cdp), 0.0):
            pass
        start = time.time()
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y0}], "timestamp": start})
        for i in range(1, TOUCH_STEPS + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y0 - d * i / TOUCH_STEPS}],
                                                  "timestamp": start + i * TOUCH_STEP_MS / 1000})
        end = start + (TOUCH_STEPS + 1) * TOUCH_STEP_MS / 1000
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [], "timestamp": end})
        _TOUCH_END[id(cdp)] = end
        left -= d
    deadline, last, still_since = time.monotonic() + POLL_S, None, time.monotonic()
    while time.monotonic() < deadline:
        now = scroll_y(page)
        if now != last:
            last, still_since = now, time.monotonic()
        elif time.monotonic() - still_since >= SETTLE_S:
            return
    pytest.fail("the page never stopped scrolling after the touch swipes")


def yaw_track(page: Page, total_ms: float) -> list[float]:
    out = []
    for _ in range(int(total_ms // TURN_STEP_MS) + 2):
        advance(page, TURN_STEP_MS)
        out.append(yaw(page))
    return out


ANN_OBSERVE_JS = "(el) => { window.__voAnn = []; new MutationObserver(() => window.__voAnn.push(el.textContent.trim())).observe(el, { subtree: true, childList: true, characterData: true }); }"
TARGET_OBSERVE_JS = "(el) => { window.__voTarget = []; new MutationObserver(() => window.__voTarget.push(el.getAttribute('data-target-yaw'))).observe(el, { attributes: true, attributeFilter: ['data-target-yaw'] }); }"


def collapsed(raw: list[str]) -> list[str]:
    seq: list[str] = []
    for t in raw:
        if not seq or seq[-1] != t:
            seq.append(t)
    return seq


def ann_seq(page: Page) -> list[str]:
    return page.evaluate("() => window.__voAnn.slice()")


def target_seq(page: Page) -> list[str]:
    return collapsed(page.evaluate("() => window.__voTarget.slice()"))


GROUND_JS = "(el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return ''; }"
SWATCH_JS = "(el, colour) => { const root = el.closest('li') || el.parentElement || el; return [root, ...root.querySelectorAll('*')].some((e) => getComputedStyle(e).backgroundColor === colour); }"
DESCRIBED_JS = "e => (e.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')"
MODAL_JS = "e => { try { if (e.matches(':modal')) return true; } catch (err) {} return e.getAttribute('aria-modal') === 'true'; }"


def first_family(loc: Locator) -> str:
    fam = loc.evaluate("e => getComputedStyle(e).fontFamily")
    return fam.split(",")[0].strip().strip("'\"")


def columns(loc: Locator) -> int:
    boxes = [b for b in (loc.nth(i).bounding_box() for i in range(loc.count())) if b]
    assert boxes, "no items to measure columns"
    top = boxes[0]["y"]
    return len([b for b in boxes if abs(b["y"] - top) < 2])


def visitor(prefix: str = "vo") -> tuple[str, str]:
    a, b = unique(prefix)
    return (a, b) if "@" in b else (b, a)


def email_of(prefix: str = "vo") -> str:
    return visitor(prefix)[1]


def enquiry(email: str, **over: Any) -> dict[str, Any]:
    body = {"name": EX_NAME, "email": email, "business_name": EX_BUSINESS, "service": "packaging", "budget": "50k-150k", "description": EX_DESCRIPTION, "item": "pack-range", "submission_id": str(uuid.uuid4())}
    body.update(over)
    return body


def post(base: str, body: Any) -> httpx.Response:
    return httpx.post(f"{base}/api/enquiries", json=body, timeout=HTTP_TIMEOUT)


def grading_key() -> str:
    key = os.environ.get("GRADING_KEY", "")
    assert key, "GRADING_KEY must be set in the verifier environment to observe stored enquiries"
    return key


def stored(base: str, email: str) -> list[dict[str, Any]]:
    r = httpx.get(f"{base}/api/grading/enquiries", params={"email": email}, headers={"X-Grading-Key": grading_key()}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"GET /api/grading/enquiries answered {r.status_code}"
    return r.json()["enquiries"]


def intake_body(req: Any) -> dict[str, Any] | None:
    stack = [req]
    for _ in range(20000):
        if not stack:
            return None
        cur = stack.pop()
        if isinstance(cur, dict):
            if "source" in cur and "reference" in cur and "email" in cur:
                return cur
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
        elif isinstance(cur, str) and cur.strip().startswith("{"):
            try:
                stack.append(json.loads(cur))
            except ValueError:
                pass
    return None


def intake_for(wiremock: Any, email: str) -> list[dict[str, Any]]:
    out = []
    for r in wiremock.requests(INTAKE_PATH):
        b = intake_body(r)
        if b and str(b.get("email", "")).lower() == email.lower():
            out.append(b)
    return out


def baseline_intake(wiremock: Any) -> None:
    wiremock.stub("POST", INTAKE_PATH, status=201, json={"intake_reference": "IN-DEMO-0001"}, headers={"Content-Type": "application/json"})


def to_review(page: Page, name: str, email: str, *, business: str = EX_BUSINESS, service: str = "Packaging", description: str = EX_DESCRIPTION, budget: str = "₹50,000 to ₹1,50,000") -> None:
    fill(textbox(page, "Name"), name)
    fill(textbox(page, "Email"), email)
    fill(textbox(page, "Business name"), business)
    click(btn(page, "Next"))
    expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
    check(page.get_by_role("radiogroup", name="Service", exact=True).get_by_role("radio", name=service, exact=True))
    fill(textbox(page, "Project description"), description)
    click(btn(page, "Next"))
    expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
    check(page.get_by_role("radiogroup", name="Approximate budget", exact=True).get_by_role("radio", name=budget, exact=True))
    click(btn(page, "Next"))
    expect(heading(page, "Step 4 of 4: Review", 2)).to_be_focused()


def review(page: Page) -> dict[str, str]:
    terms = texts(page.get_by_role("main").get_by_role("term"))
    values = [d.inner_text().strip() for d in page.get_by_role("main").get_by_role("definition").all()]
    return dict(zip(terms, values))


def assert_sent(page: Page, name: str, record: dict[str, Any]) -> None:
    expect(heading(page, "Enquiry received", 2)).to_be_focused()
    line = f"Thank you, {name}. Your enquiry {record['reference']} was recorded and handed to the studio's intake service as {record['intake_reference']}."
    expect(page.get_by_text(line, exact=True)).to_be_visible()
    expect(page.get_by_text("Vellum Orbit Studio is fictional, so no one will contact you.", exact=True)).to_be_visible()
    expect(lnk(page.get_by_role("main"), "Back to the worlds")).to_be_visible()
    expect(btn(page, "Start another enquiry")).to_be_visible()
    expect(page.get_by_role("status", name="Enquiry status", exact=True)).to_have_text("")


def glb_vertices(data: bytes) -> int:
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2 and length == len(data), "not a binary glTF 2.0 file"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == GLB_JSON_CHUNK, "first GLB chunk is not JSON"
    doc = json.loads(data[20:20 + clen])
    accessors = doc.get("accessors", [])
    seen: set[int] = set()
    total = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx = prim.get("attributes", {}).get("POSITION")
            if idx is not None and idx not in seen:
                seen.add(idx)
                total += int(accessors[idx]["count"])
    return total


def svg_size(text: str) -> tuple[float, float]:
    root = re.search(r"<svg\b[^>]*>", text, re.S)
    assert root, "no <svg> root element"
    tag = root.group(0)
    vb = re.search(r'viewBox\s*=\s*["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', tag)
    if vb:
        return float(vb.group(1)), float(vb.group(2))
    w = re.search(r'\bwidth\s*=\s*["\']([\d.]+)', tag)
    h = re.search(r'\bheight\s*=\s*["\']([\d.]+)', tag)
    assert w and h, "svg has neither viewBox nor width and height"
    return float(w.group(1)), float(h.group(1))


def env_secrets() -> list[str]:
    names = ["DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "WIREMOCK_URL", "GRADING_KEY"]
    return [os.environ[n] for n in names if len(os.environ.get(n, "")) >= 6]


def tiles(page: Page) -> Locator:
    return page.get_by_role("list", name="Projects", exact=True).get_by_role("link")


def service_group(page: Page) -> Locator:
    return page.get_by_role("group", name="Filter by service", exact=True)


def industry_box(page: Page) -> Locator:
    return page.get_by_role("combobox", name="Industry", exact=True)


def industry_options(page: Page) -> list[str]:
    return industry_box(page).evaluate("s => [...s.options].map(o => o.textContent.replace(/\\s+/g, ' ').trim())")


def industry_selected(page: Page) -> str:
    return industry_box(page).evaluate("s => s.options[s.selectedIndex].textContent.replace(/\\s+/g, ' ').trim()")


def svc_btn(page: Page, prefix: str) -> Locator:
    return service_group(page).get_by_role("button", name=re.compile("^" + re.escape(prefix) + r" \(\d+\)$"))


def price_article(page: Page, name: str) -> Locator:
    return page.get_by_role("main").get_by_role("article").filter(has=heading(page, name, 2))


def price_names(page: Page) -> list[str]:
    return texts(page.get_by_role("main").get_by_role("article").get_by_role("heading", level=2))


def category_radio(page: Page, label: str) -> Locator:
    return page.get_by_role("radiogroup", name="Category", exact=True).get_by_role("radio", name=label, exact=True)


def type_radio(page: Page, label: str) -> Locator:
    return page.get_by_role("radiogroup", name="Price type", exact=True).get_by_role("radio", name=label, exact=True)


TARGETS_JS = """(min) => {
  const bad = [];
  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="link"]';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) continue;
    let r = el.getBoundingClientRect();
    if (r.bottom + window.scrollY <= 0 || r.left >= window.innerWidth || r.right <= 0) continue;
    const lab = el.labels && el.labels[0] ? el.labels[0].getBoundingClientRect() : null;
    if (r.width <= 1 || r.height <= 1) { if (!lab) continue; r = lab; }
    if (r.width < min || r.height < min) {
      if (lab && lab.width >= min && lab.height >= min) continue;
      bad.push(((el.getAttribute('aria-label') || el.textContent || el.name || el.tagName) + '').trim().slice(0, 50) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return bad;
}"""


def test_pages_and_titles(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        for path, title in SITE_MAP:
            response = page.goto(app_url + path)
            assert response is not None and response.status == 200, f"GET {path} should answer 200"
            expect(page).to_have_title(title)
            expect(page.get_by_role("main")).to_have_count(1)
            expect(page.get_by_role("heading", level=1)).to_have_count(1)
            assert page.evaluate("() => document.documentElement.lang").lower().startswith("en"), f"{path} is not marked English"
            clash = page.evaluate("() => [...document.querySelectorAll('[data-section]')].map(e => e.dataset.section).filter(n => document.getElementById(n))")
            assert clash == [], f"{path}: elements have ids equal to section names {clash}"
        page.goto(app_url + "/")
        for section in ["intro", "worlds", "studio-in-brief"]:
            expect(page.locator(f'[data-section="{section}"]')).to_have_count(1)
        for path, h1, link_name, target in NOT_FOUND:
            response = page.goto(app_url + path)
            assert response is not None and response.status == 404, f"GET {path} should answer 404"
            expect(page).to_have_title("Not found | Vellum Orbit Studio")
            expect(heading(page, h1, 1)).to_be_visible()
            link = lnk(page.get_by_role("main"), link_name)
            expect(link).to_be_visible()
            assert href_path(link) == target


CURRENT = {"/": [], "/worlds/quillstack": [], "/faq": [], "/work": ["Work"], "/work/relaywise": ["Work"], "/services": ["Services"], "/services/packaging": ["Services"], "/studio": ["Studio"], "/pricing": ["Pricing"], "/contact": ["Contact"]}


def test_header_skip_link_current(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        for path, current in CURRENT.items():
            page.goto(app_url + path)
            nav = page.get_by_role("navigation", name="Main", exact=True)
            expect(nav).to_be_visible()
            assert texts(nav.get_by_role("link")) == MAIN_LINKS
            marked = nav.get_by_role("link").evaluate_all("els => els.filter(e => e.getAttribute('aria-current') === 'page').map(e => e.textContent.trim())")
            assert marked == current, f"{path}: current links {marked}, expected {current}"
            expect(btn(page, "Menu")).to_have_count(0)
            banner = page.get_by_role("banner")
            expect(lnk(banner, "Vellum Orbit Studio home")).to_be_visible()
            box = banner.bounding_box()
            assert box and abs(box["height"] - HEADER_PX) <= SCROLL_TOL_PX and abs(box["y"]) <= SCROLL_TOL_PX
            assert banner.evaluate("e => getComputedStyle(e).position") == "fixed"
        page.goto(app_url + "/studio")
        assert tab_order(page, 1) == ["Skip to content"]
        skip = lnk(page, "Skip to content")
        sbox = skip.bounding_box()
        assert sbox and sbox["width"] > 1 and sbox["y"] >= 0 and sbox["y"] < H_DESKTOP, "focused skip link must be visible"
        page.keyboard.press("Enter")
        expect(heading(page, "The studio", 1)).to_be_focused()
        rest = skip.bounding_box()
        assert rest is None or rest["width"] * rest["height"] <= 1 or rest["y"] + rest["height"] <= 0 or rest["x"] + rest["width"] <= 0, "skip link visible while not focused"
        scroll_to(page, 600)
        box = page.get_by_role("banner").bounding_box()
        assert box and abs(box["y"]) <= SCROLL_TOL_PX, "header must stay fixed to the top while scrolling"
        page.set_viewport_size({"width": W_PHONE, "height": H_PHONE})
        page.goto(app_url + "/work")
        expect(btn(page, "Menu")).to_be_visible()
        expect(page.get_by_role("navigation", name="Main", exact=True)).to_have_count(0)
        box = page.get_by_role("banner").bounding_box()
        assert box and abs(box["height"] - HEADER_PX) <= SCROLL_TOL_PX


FOOTER_LINKS = [("Work", "/work"), ("Services", "/services"), ("Studio", "/studio"), ("Pricing", "/pricing"), ("Questions", "/faq"), ("Contact", "/contact")]
SOCIAL = [("Instagram (opens in a new tab)", "https://instagram.example/vellumorbit"), ("Behance (opens in a new tab)", "https://behance.example/vellumorbit"), ("LinkedIn (opens in a new tab)", "https://linkedin.example/company/vellumorbit")]
FOOTER_NOTICE = "Vellum Orbit Studio is a fictional studio. Every client, person, price and contact detail on this site is illustrative."


def test_footer_contact(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        for _, target in SOCIAL:
            page.context.route(target, lambda route: route.fulfill(body=""))
        for path in ["/", "/work", "/worlds/ledgerwick", "/work/copperline", "/pricing", "/contact", f"/{PROBE_UNKNOWN}"]:
            page.goto(app_url + path)
            footer = page.get_by_role("contentinfo")
            expect(footer).to_have_count(1)
            assert page.get_by_role("main").evaluate("(m, f) => !!(m.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)", footer.element_handle()), "footer must follow main"
            text = footer.evaluate("e => e.textContent.replace(/\\s+/g, ' ')")
            order = [FOOTER_NOTICE, "Illustrative contact", "hello@vellumorbit.example", "+91 484 555 0142", "Kochi, Kerala", "© 2026 Vellum Orbit Studio"]
            positions = [text.find(t) for t in order]
            assert all(p >= 0 for p in positions) and positions == sorted(positions), f"{path}: footer copy out of order or missing {positions}"
            fnav = footer.get_by_role("navigation", name="Footer", exact=True)
            for name, target in FOOTER_LINKS:
                assert href_path(lnk(fnav, name)) == target
            contact = heading(footer, "Illustrative contact", 2)
            expect(contact).to_be_visible()
            assert lnk(footer, "hello@vellumorbit.example").get_attribute("href") == "mailto:hello@vellumorbit.example"
            assert lnk(footer, "+91 484 555 0142").get_attribute("href") == "tel:+914845550142"
            social = footer.get_by_role("navigation", name="Social (illustrative)", exact=True)
            for name, target in SOCIAL:
                link = lnk(social, name)
                assert link.get_attribute("href") == target
                with page.context.expect_page() as opened_tab:
                    click(link)
                new_tab = opened_tab.value
                new_tab.wait_for_load_state()
                assert new_tab.evaluate("() => window.opener === null"), f"{name} must open a new tab without access back"
                new_tab.close()
            follows = "(a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)"
            assert fnav.evaluate(follows, contact.element_handle()), "Footer navigation must precede Illustrative contact"
            assert contact.evaluate(follows, social.element_handle()), "Illustrative contact must precede the social navigation"


def test_opening_scene(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        h1 = heading(page, "Eight brands. Eight worlds. One small studio.", 1)
        expect(h1).to_be_visible()
        for line in ["Eight brands.", "Eight worlds.", "One small studio."]:
            assert h1.evaluate("(h, l) => [...h.querySelectorAll('*')].some(e => e.textContent.trim() === l)", line), f"intro line {line!r} is not its own element"
        expect(page.get_by_text("Vellum Orbit is a two-founder branding and digital design studio in Kochi. Step inside the work.", exact=True)).to_be_visible()
        intro_height = h1.evaluate("h => h.closest('[data-section=\"intro\"]').getBoundingClientRect().height")
        assert intro_height >= H_DESKTOP - SCROLL_TOL_PX, "intro must fill the viewport height"
        assert tab_order(page, 8) == ["Skip to content", "Vellum Orbit Studio home", *MAIN_LINKS, "Enter the worlds"]
        advance(page, FRAME_MS)
        expect(announcer(page)).to_have_text("")
        g = geometry(page)
        page.keyboard.press("Enter")
        expect(stage(page)).to_have_attribute("data-camera", "descending")
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        expect(announcer(page)).to_have_text(world_line(1))
        assert_scroll_at(page, world_y(g, 1), "Enter the worlds")
        expect(stage(page)).to_have_attribute("data-active-world", "ledgerwick")
        advance(page, DESCENT_MS / 2)
        assert sattr(page, "camera") == "descending", "descent ended long before its 900 ms"
        advance(page, DESCENT_MS / 2 + FRAME_MS)
        assert sattr(page, "camera") == "ring"
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, mode="3d") as page:
        assert tab_order(page, 4) == ["Skip to content", "Vellum Orbit Studio home", "Menu", "Enter the worlds"]
        g = geometry(page)
        scroll_to(page, world_y(g, 3))
        expect(stage(page)).to_have_attribute("data-active-world", "basalt-beam")
        assert sattr(page, "camera") == "ring", "scrolling past the intro must not run the descent"


def test_stage_state_attributes(browser: Browser, app_url: str) -> None:
    one_decimal = re.compile(r"\d{1,3}\.\d")
    with opened(browser, app_url + "/", mode="3d") as page:
        assert sattr(page, "active-world") == "ledgerwick"
        assert sattr(page, "yaw") == "0.0" and sattr(page, "target-yaw") == "0.0" and sattr(page, "camera") == "ring"
        assert one_decimal.fullmatch(sattr(page, "emblem-angle"))
        to_ring(page)
        for k in [3, 8, 2]:
            w = WORLDS[k - 1]
            click(rail_btn(page, w["name"]))
            expect(stage(page)).to_have_attribute("data-active-world", w["slug"])
            expect(stage(page)).to_have_attribute("data-target-yaw", yaw_text(k))
            expect(heading(stage(page), w["name"], 2)).to_be_visible()
            expect(stage(page)).to_contain_text(f"0{k} / 08")
            expect(stage(page)).to_contain_text(INDUSTRIES[w["industry"]])
            expect(rail_btn(page, w["name"])).to_have_attribute("aria-current", "true")
            assert rail(page).get_by_role("button").evaluate_all("els => els.filter(e => e.getAttribute('aria-current') === 'true').length") == 1
            expect(announcer(page)).to_have_text(world_line(k))
            expect(btn(stage(page), f"Enter {w['name']}")).to_be_visible()
            advance(page, TURN_MS + FRAME_MS)
            assert one_decimal.fullmatch(sattr(page, "yaw")) and sattr(page, "yaw") == yaw_text(k)
    with opened(browser, app_url + "/studio") as page:
        with held(page, "**/scenes/**") as hold:
            page.goto(app_url + "/")
            expect(stage(page)).to_have_attribute("data-mode", "loading")
            expect(stage(page)).to_contain_text("Loading the worlds…")
            to_ring(page)
            click(btn(page, "Next world"))
            expect(stage(page)).to_have_attribute("data-active-world", "monsoon-crate")
            expect(stage(page)).to_have_attribute("data-target-yaw", "45.0")
            expect(heading(stage(page), "Monsoon Crate Coffee", 2)).to_be_visible()
            hold.release()
        wait_attr(page, "mode", "3d")
    with opened(browser, app_url + "/", no_webgl=True, mode="still") as page:
        assert sattr(page, "active-world") == "ledgerwick" and sattr(page, "yaw") == "0.0" and sattr(page, "target-yaw") == "0.0" and sattr(page, "camera") == "ring"


def test_enter_and_leave_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        click(rail_btn(page, "Basalt & Beam"))
        advance(page, TURN_MS + FRAME_MS)
        assert_scroll_at(page, world_y(g, 3), "rail selection")
        before = page.evaluate("() => history.length")
        click(btn(page, "Enter Basalt & Beam"))
        expect(page).to_have_url(re.compile(r"/worlds/basalt-beam$"))
        expect(page).to_have_title("Basalt & Beam | Vellum Orbit Studio")
        h1 = heading(page, "Basalt & Beam", 1)
        expect(h1).to_be_focused()
        expect(page.get_by_role("article")).to_be_visible()
        assert sattr(page, "camera") == "entering"
        assert page.evaluate("() => history.length") == before + 1, "entering must push a new history entry"
        assert_clear(page, h1, "world heading")
        advance(page, FLIGHT_MS / 2)
        assert sattr(page, "camera") == "entering", "flight ended long before its 700 ms"
        advance(page, FLIGHT_MS / 2 + FRAME_MS)
        assert sattr(page, "camera") == "inside" and sattr(page, "yaw") == sattr(page, "target-yaw")
        click(btn(page, "Back to all worlds"))
        expect(page).to_have_url(re.compile(r"/$"))
        assert sattr(page, "camera") == "leaving"
        assert sattr(page, "active-world") == "basalt-beam"
        expect(btn(page, "Enter Basalt & Beam")).to_be_focused()
        assert_scroll_at(page, world_y(g, 3), "leaving the world")
        advance(page, FLIGHT_MS + FRAME_MS)
        assert sattr(page, "camera") == "ring"
        page.keyboard.press("Enter")
        expect(heading(page, "Basalt & Beam", 1)).to_be_focused()
        advance(page, FLIGHT_MS + FRAME_MS)
        page.keyboard.press("Escape")
        expect(page).to_have_url(re.compile(r"/$"))
        expect(btn(page, "Enter Basalt & Beam")).to_be_focused()
        assert sattr(page, "camera") == "leaving" and sattr(page, "active-world") == "basalt-beam"
        assert_scroll_at(page, world_y(g, 3), "Escape from the world")


def test_world_to_world_links(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/worlds/ledgerwick") as page:
        assert sattr(page, "camera") == "inside" and sattr(page, "yaw") == sattr(page, "target-yaw") == "0.0"
        expect(page.get_by_role("link", name=re.compile(r"^Previous world:"))).to_have_count(0)
        click(lnk(page, "Next world: Monsoon Crate Coffee"))
        expect(page).to_have_url(re.compile(r"/worlds/monsoon-crate$"))
        expect(page).to_have_title("Monsoon Crate Coffee | Vellum Orbit Studio")
        expect(heading(page, "Monsoon Crate Coffee", 1)).to_be_focused()
        assert sattr(page, "active-world") == "monsoon-crate" and sattr(page, "target-yaw") == yaw_text(2)
        assert sattr(page, "camera") == "entering"
        advance(page, FLIGHT_MS + FRAME_MS)
        assert sattr(page, "camera") == "inside"
        click(lnk(page, "Previous world: Ledgerwick Advisory"))
        expect(heading(page, "Ledgerwick Advisory", 1)).to_be_focused()
        assert sattr(page, "target-yaw") == "0.0" and sattr(page, "active-world") == "ledgerwick"
        page.goto(app_url + "/worlds/quillstack")
        expect(lnk(page, "Previous world: Basalt & Beam")).to_be_visible()
        expect(lnk(page, "Next world: Neem & Nectar")).to_be_visible()
        page.goto(app_url + "/worlds/static-bloom")
        expect(page.get_by_role("link", name=re.compile(r"^Next world:"))).to_have_count(0)
        click(lnk(page, "Previous world: Tiffin Theory"))
        expect(page).to_have_url(re.compile(r"/worlds/tiffin-theory$"))
        assert sattr(page, "target-yaw") == yaw_text(7)


def test_world_rail_keys(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        btn(page, "Enter the worlds").focus()
        page.keyboard.press("Enter")
        first = rail_btn(page, "Ledgerwick Advisory")
        expect(first).to_be_focused()
        expect(btn(page, "Previous world")).to_be_disabled()
        expect(btn(page, "Next world")).to_be_enabled()
        page.keyboard.press("Shift+Tab")
        assert not rail(page).evaluate("n => n.contains(document.activeElement)"), "Shift+Tab should leave the rail"
        page.keyboard.press("Tab")
        assert rail(page).evaluate("n => n.contains(document.activeElement) && document.activeElement.getAttribute('aria-current') === 'true'"), "Tab must enter the rail on its active button"
        page.keyboard.press("Shift+Tab")
        assert not rail(page).evaluate("n => n.contains(document.activeElement)"), "the rail must have only one Tab stop"
        advance(page, FRAME_MS)
        first.focus()
        for key, k in [("ArrowRight", 2), ("ArrowDown", 3), ("ArrowLeft", 2), ("ArrowUp", 1), ("ArrowLeft", 1), ("ArrowUp", 1), ("End", 8), ("ArrowRight", 8), ("ArrowDown", 8), ("Home", 1), ("End", 8)]:
            page.keyboard.press(key)
            w = WORLDS[k - 1]
            target = rail_btn(page, w["name"])
            expect(target).to_be_focused()
            expect(target).to_have_attribute("aria-current", "true")
            expect(stage(page)).to_have_attribute("data-active-world", w["slug"])
        expect(btn(page, "Next world")).to_be_disabled()
        expect(btn(page, "Previous world")).to_be_enabled()
        click(rail_btn(page, "Quillstack"))
        expect(stage(page)).to_have_attribute("data-active-world", "quillstack")
        expect(rail_btn(page, "Quillstack")).to_have_attribute("aria-current", "true")
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, mode="3d") as page:
        to_ring(page)
        tap(rail_btn(page, "Neem & Nectar"))
        expect(stage(page)).to_have_attribute("data-active-world", "neem-nectar")
        expect(rail_btn(page, "Neem & Nectar")).to_have_attribute("aria-current", "true")


def test_ring_turn(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        to_ring(page)
        click(btn(page, "Next world"))
        assert sattr(page, "target-yaw") == yaw_text(2)
        samples = yaw_track(page, TURN_MS)
        assert samples[1] < STEP_YAW, "turn finished almost at once; expected about 450 ms"
        assert all(b >= a for a, b in zip(samples, samples[1:])), f"yaw must rise in one direction {samples}"
        assert all(0.0 <= s <= STEP_YAW for s in samples)
        mid = samples[len(samples) // 2 - 1]
        assert 0.0 < mid < STEP_YAW, f"yaw should be between worlds mid-turn, got {mid}"
        assert sattr(page, "yaw") == yaw_text(2), "yaw must reach the target exactly within the turn time"
        rail_btn(page, "Monsoon Crate Coffee").focus()
        page.keyboard.press("End")
        assert sattr(page, "target-yaw") == "315.0"
        up = yaw_track(page, TURN_MS)
        assert all(b >= a for a, b in zip(up, up[1:])) and up[-1] == MAX_YAW
        assert any(STEP_YAW < s < LAST_STEP_YAW for s in up), "the turn must pass straight through the worlds between"
        page.keyboard.press("Home")
        down = yaw_track(page, TURN_MS)
        assert all(b <= a for a, b in zip(down, down[1:])), f"turn back must fall in one direction {down}"
        assert all(0.0 <= s <= MAX_YAW for s in down) and down[-1] == 0.0
        assert any(STEP_YAW < s < LAST_STEP_YAW for s in down), "315 to 0 must turn back through every world"


def test_pointer_drag(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_SMALL, y, steps=4)
        advance(page, FRAME_MS)
        assert abs(yaw(page) - PROBE_DRAG_SMALL * DRAG_FACTOR) <= 0.05, f"drawn yaw {yaw(page)} should follow the pointer"
        page.mouse.move(x - PROBE_DRAG_HUGE, y, steps=8)
        advance(page, FRAME_MS)
        assert yaw(page) == STEP_YAW, "drag must stop at one world"
        page.mouse.move(x + PROBE_DRAG_SMALL, y, steps=8)
        advance(page, FRAME_MS)
        assert yaw(page) == 0.0, "yaw never goes below 0.0"
        page.mouse.move(x + PROBE_DRAG_LONG, y, steps=4)
        page.mouse.up()
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == "ledgerwick" and yaw(page) == 0.0, "right drag at world 1 selects nothing"
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_SHORT, y, steps=4)
        page.mouse.up()
        assert sattr(page, "active-world") == "ledgerwick"
        advance(page, TURN_MS + FRAME_MS)
        assert yaw(page) == 0.0, "a short drag turns back to the unchanged target"
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=4)
        advance(page, FRAME_MS)
        drawn = yaw(page)
        page.mouse.up()
        expect(stage(page)).to_have_attribute("data-active-world", "monsoon-crate")
        assert sattr(page, "target-yaw") == yaw_text(2)
        advance(page, FRAME_MS)
        assert drawn - 0.1 <= yaw(page) <= STEP_YAW, "turn starts from the drawn yaw"
        advance(page, TURN_MS)
        assert yaw(page) == STEP_YAW
        assert_scroll_at(page, world_y(g, 2), "drag selection")
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_HUGE, y, steps=8)
        page.mouse.up()
        expect(stage(page)).to_have_attribute("data-active-world", "basalt-beam")
        assert sattr(page, "target-yaw") == yaw_text(3), "one drag selects at most one world"
        advance(page, TURN_MS + FRAME_MS)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.up()
        advance(page, FRAME_MS)
        assert sattr(page, "active-world") == "basalt-beam" and sattr(page, "yaw") == yaw_text(3), "a press without movement does nothing"
        click(rail_btn(page, "Static Bloom"))
        advance(page, TURN_MS + FRAME_MS)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=4)
        advance(page, FRAME_MS)
        assert yaw(page) <= MAX_YAW
        page.mouse.up()
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == "static-bloom" and yaw(page) == MAX_YAW, "left drag at world 8 selects nothing"


def test_scroll_selects_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = geometry(page)
        assert abs(g["height"] - 8 * g["vh"]) <= SCROLL_TOL_PX, "worlds section must be 8 viewport heights tall"
        for p, slug in [(2.4, "basalt-beam"), (2.6, "quillstack"), (0.0, "ledgerwick"), (6.9, "static-bloom"), (4.45, "neem-nectar")]:
            scroll_to(page, g["top"] + p * g["vh"])
            expect(stage(page)).to_have_attribute("data-active-world", slug)
        scroll_to(page, g["brief"])
        expect(stage(page)).to_have_attribute("data-active-world", "static-bloom")
        scroll_to(page, 0)
        expect(stage(page)).to_have_attribute("data-active-world", "ledgerwick")
        to_ring(page)
        click(rail_btn(page, "Neem & Nectar"))
        assert_scroll_at(page, world_y(g, 5), "rail click")
        click(btn(page, "Next world"))
        assert_scroll_at(page, world_y(g, 6), "Next world")
        rail_btn(page, "Reelhouse Pictures").focus()
        page.keyboard.press("End")
        assert_scroll_at(page, world_y(g, 8), "End key")


def test_reversed_scroll_mid_turn(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        scroll_to(page, world_y(g, 2))
        expect(stage(page)).to_have_attribute("data-target-yaw", yaw_text(2))
        advance(page, TURN_MS / 2)
        shown = yaw(page)
        assert 0.0 < shown < STEP_YAW, f"expected a turn in progress, yaw {shown}"
        scroll_to(page, world_y(g, 1))
        expect(stage(page)).to_have_attribute("data-active-world", "ledgerwick")
        assert sattr(page, "target-yaw") == "0.0"
        advance(page, 16)
        first = yaw(page)
        assert 0.0 < first <= shown, f"fresh turn must start from the drawn yaw {shown}, got {first}"
        rest = yaw_track(page, TURN_MS)
        seq = [first, *rest]
        assert all(b <= a for a, b in zip(seq, seq[1:])), f"reversed turn must move back in one direction {seq}"
        assert sattr(page, "yaw") == "0.0"


def test_world_announcer(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        expect(announcer(page)).to_have_text("")
        announcer(page).evaluate(ANN_OBSERVE_JS)
        g = geometry(page)
        btn(page, "Enter the worlds").focus()
        page.keyboard.press("Enter")
        expect(announcer(page)).to_have_text(world_line(1))
        click(rail_btn(page, "Ledgerwick Advisory"))
        scroll_to(page, world_y(g, 2))
        expect(announcer(page)).to_have_text(world_line(2))
        for p in [1.3, 0.7, 1.2]:
            scroll_to(page, g["top"] + p * g["vh"])
        advance(page, TURN_MS + FRAME_MS)
        scroll_to(page, 0)
        expect(announcer(page)).to_have_text(world_line(1))
        click(btn(page, "Enter the worlds"))
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        assert ann_seq(page) == [world_line(1), world_line(2), world_line(1)], f"announcer sequence {ann_seq(page)}"
    with opened(browser, app_url + "/", no_webgl=True, mode="still") as page:
        click(btn(page, "Enter the worlds"))
        expect(lnk(page, "Explore Ledgerwick Advisory")).to_be_focused()
        if announcer(page).count():
            expect(announcer(page)).to_have_text("")


def test_visible_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/") as page:
        for loc in [btn(page, "Enter the worlds"), lnk(page, "Vellum Orbit Studio home"), lnk(page.get_by_role("contentinfo"), "Pricing")]:
            rest, focus = state_styles(loc, "outline-style", "outline-width", state="focus")
            assert focus["outline-style"] != "none" and float(focus["outline-width"].replace("px", "") or 0) >= 2, f"focus ring missing: {focus}"
            assert rest["outline-style"] == "none" or float(rest["outline-width"].replace("px", "") or 0) == 0, f"ring shown at rest: {rest}"
        page.goto(app_url + "/studio")
        tab_order(page, 3)
        assert scroll_y(page) == 0, "focus already in the clear zone must not scroll"
        page.goto(app_url + "/faq")
        main = page.get_by_role("main")
        q4, q5 = btn(main, QUESTIONS[3][1]), btn(main, QUESTIONS[4][1])
        top5 = page.evaluate("(e) => e.getBoundingClientRect().top + window.scrollY", q5.element_handle())
        scroll_to(page, top5 - (CLEAR_TOP + 20))
        before = scroll_y(page)
        box = q5.bounding_box()
        assert box is not None
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        expect(q5).to_have_attribute("aria-expanded", "true")
        assert abs(scroll_y(page) - before) <= SCROLL_TOL_PX, "a pointer click must never scroll the page"
        page.keyboard.press("ArrowUp")
        expect(q4).to_be_focused()
        b4 = q4.bounding_box()
        assert b4 and abs(b4["y"] - CLEAR_TOP) <= SCROLL_TOL_PX, f"keyboard focus must scroll just clear of the header, top {b4}"
        after = scroll_y(page)
        page.keyboard.press("ArrowDown")
        expect(q5).to_be_focused()
        assert abs(scroll_y(page) - after) <= SCROLL_TOL_PX, "element already in the clear zone must not scroll"
        page.goto(app_url + "/work")
        click(svc_btn(page, "Brand identity"))
        before = scroll_y(page)
        click(btn(page, "Clear filters"))
        expect(svc_btn(page, "Brand identity")).to_be_focused()
        assert abs(scroll_y(page) - before) <= SCROLL_TOL_PX, "Clear filters must not scroll when the first filter is already clear"


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        click(btn(page, "Enter the worlds"))
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        expect(announcer(page)).to_have_text(world_line(1))
        assert sattr(page, "camera") == "ring"
        click(btn(page, "Next world"))
        expect(stage(page)).to_have_attribute("data-target-yaw", yaw_text(2))
        assert sattr(page, "yaw") == yaw_text(2), "turn must complete at once"
        rail_btn(page, "Monsoon Crate Coffee").focus()
        page.keyboard.press("End")
        expect(stage(page)).to_have_attribute("data-target-yaw", "315.0")
        assert sattr(page, "yaw") == "315.0"
        expect(announcer(page)).to_have_text(world_line(8))
        click(btn(page, "Enter Static Bloom"))
        expect(heading(page, "Static Bloom", 1)).to_be_focused()
        assert sattr(page, "camera") == "inside"
        click(btn(page, "Back to all worlds"))
        expect(btn(page, "Enter Static Bloom")).to_be_focused()
        assert sattr(page, "camera") == "ring"
        assert animations(page.locator("body")) == [], "no stylesheet or script animation may run with reduced motion"
        page.goto(app_url + "/work/ledgerwick")
        click(btn(page, f"Open image 1 of 4: {CAPTIONS['ledgerwick'][0]}"))
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        click(btn(dialog, "Next image"))
        expect(dialog).to_contain_text("Image 2 of 4")
        assert animations(dialog) == []
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": W_PHONE, "height": H_PHONE})
        page.goto(app_url + "/studio")
        click(btn(page, "Menu"))
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(menu).to_be_visible()
        assert animations(menu) == [] and animations(page.locator("body")) == []


def test_idle_emblem_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        prev = float(sattr(page, "emblem-angle"))
        assert float(sattr(page, "emblem-angle")) == prev, "angle must not move without the page clock"
        wrapped = False
        for _ in range(7):
            advance(page, EMBLEM_STEP_MS)
            cur = float(sattr(page, "emblem-angle"))
            assert 0.0 <= cur <= 359.9
            delta = (cur - prev) % 360
            assert abs(delta - EMBLEM_DEG_PER_S * EMBLEM_STEP_MS / 1000) <= EMBLEM_TOL_DEG, f"emblem moved {delta} degrees in {EMBLEM_STEP_MS} ms"
            wrapped = wrapped or cur < prev
            prev = cur
        assert wrapped, f"over {7 * EMBLEM_STEP_MS} ms (more than {EMBLEM_TURN_MS} ms) the angle must wrap past 360"
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        advance(page, EMBLEM_STEP_MS)
        assert sattr(page, "emblem-angle") == "0.0"
    with opened(browser, app_url + "/", no_webgl=True, mode="still") as page:
        held_value = sattr(page, "emblem-angle")
        advance(page, EMBLEM_STEP_MS)
        assert sattr(page, "emblem-angle") == held_value


def test_scene_models(browser: Browser, app_url: str) -> None:
    s3 = S3()
    total = 0
    for slug in WORLD_IDS:
        r = httpx.get(f"{app_url}/scenes/{slug}/world.glb", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.headers.get("content-type", "").startswith("model/gltf-binary")
        assert glb_vertices(r.content) >= MODEL_MIN_VERTICES, f"{slug} model has too few vertices"
        assert s3.get(f"scenes/{slug}/world.glb") == r.content, f"{slug} model is not streamed from the bucket key"
        total += len(r.content)
        assert httpx.head(f"{app_url}/scenes/{slug}/world.glb", timeout=HTTP_TIMEOUT).status_code == 200
    assert total <= MODELS_MAX_BYTES
    for path in ["/", "/worlds/reelhouse"]:
        with opened(browser, app_url + "/studio") as page:
            seen: set[str] = set()
            page.on("request", lambda req: seen.add(urlparse(req.url).path))
            page.goto(app_url + path)
            wait_attr(page, "mode", "3d")
            missing = [s for s in WORLD_IDS if f"/scenes/{s}/world.glb" not in seen]
            assert missing == [], f"{path} did not fetch models for {missing}"


def test_still_layout_without_webgl(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", no_webgl=True, mode="still") as page:
        region = page.get_by_role("region", name="Worlds", exact=True)
        expect(heading(region, "The eight worlds", 2)).to_be_visible()
        expect(region.get_by_text("Your browser cannot show the 3D worlds, so here they are as a still gallery.", exact=True)).to_be_visible()
        expect(btn(page, "Try 3D again")).to_have_count(0)
        cards = page.get_by_role("list", name="Worlds", exact=True).get_by_role("article")
        expect(cards).to_have_count(WORLD_COUNT)
        assert texts(cards.get_by_role("heading", level=3)) == [w["name"] for w in WORLDS]
        for i, w in enumerate(WORLDS):
            card = cards.nth(i)
            expect(card).to_contain_text(INDUSTRIES[w["industry"]])
            expect(card).to_contain_text(WORLD_COPY[w["slug"]]["summary"])
            assert href_path(lnk(card, f"Explore {w['name']}")) == f"/worlds/{w['slug']}"
            expect(btn(page, f"Enter {w['name']}")).to_have_count(0)
        expect(stage(page).locator("canvas")).to_have_count(0)
        expect(rail(page)).to_have_count(0)
        expect(btn(page, "Previous world")).to_have_count(0)
        expect(btn(page, "Next world")).to_have_count(0)
        g = geometry(page)
        assert g["height"] < 8 * g["vh"], "still section must be only as tall as its content"
        click(btn(page, "Enter the worlds"))
        expect(lnk(page, "Explore Ledgerwick Advisory")).to_be_focused()
        assert sattr(page, "camera") == "ring"
        scroll_to(page, g["brief"])
        assert sattr(page, "active-world") == "ledgerwick" and sattr(page, "yaw") == "0.0"
        click_clear(lnk(page, "Explore Neem & Nectar"))
        expect(page).to_have_url(re.compile(r"/worlds/neem-nectar$"))
        expect(heading(page, "Neem & Nectar", 1)).to_be_visible()
        expect(page.get_by_role("article")).to_be_visible()
        expect(page.locator("canvas")).to_have_count(0)
        assert sattr(page, "camera") == "inside"
        click(btn(page, "Back to all worlds"))
        explore = lnk(page, "Explore Neem & Nectar")
        expect(explore).to_be_focused()
        assert_clear(page, explore, "Explore Neem & Nectar")
        assert sattr(page, "active-world") == "neem-nectar" and sattr(page, "yaw") == "180.0" and sattr(page, "target-yaw") == "180.0" and sattr(page, "camera") == "ring"
        click(lnk(page, "Explore Reelhouse Pictures"))
        expect(heading(page, "Reelhouse Pictures", 1)).to_be_visible()
        page.go_back()
        expect(lnk(page, "Explore Reelhouse Pictures")).to_be_focused()
        assert sattr(page, "active-world") == "reelhouse" and sattr(page, "target-yaw") == "225.0"


def test_scene_failure_and_retry(browser: Browser, app_url: str) -> None:
    glob = "**/scenes/quillstack/world.glb"
    notice = "Some 3D scenes could not load, so the worlds are shown as a still gallery."
    with opened(browser, app_url + "/studio") as page:
        page.route(glob, lambda route: route.fulfill(status=503, body="{}"))
        page.goto(app_url + "/")
        wait_attr(page, "mode", "still")
        expect(page.get_by_text(notice, exact=True)).to_be_visible()
        expect(page.get_by_role("list", name="Worlds", exact=True).get_by_role("article")).to_have_count(WORLD_COUNT)
        expect(rail(page)).to_have_count(0)
        page.unroute(glob)
        page.route(glob, lambda route: route.abort())
        click(btn(page, "Try 3D again"))
        wait_attr(page, "mode", "still")
        expect(page.get_by_text(notice, exact=True)).to_be_visible()
        expect(btn(page, "Try 3D again")).to_be_visible()
        page.unroute(glob)
        click(btn(page, "Try 3D again"))
        wait_attr(page, "mode", "3d")
        assert sattr(page, "active-world") == "ledgerwick"
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        expect(btn(page, "Try 3D again")).to_have_count(0)
        expect(announcer(page)).to_have_text("")


def test_files_and_outage(browser: Browser, app_url: str) -> None:
    s3 = S3()
    for p in PROJECTS:
        for n in range(1, 5):
            r = httpx.get(f"{app_url}/media/{p['slug']}/{n}.svg", timeout=HTTP_TIMEOUT)
            assert r.status_code == 200 and r.headers.get("content-type", "").startswith("image/svg+xml")
            w, h = svg_size(r.text)
            assert w >= SVG_MIN_W and h >= SVG_MIN_H, f"{p['slug']}/{n}.svg is {w}x{h}"
            assert s3.get(f"media/{p['slug']}/{n}.svg") == r.content
    for path in [f"/scenes/{PROBE_UNKNOWN}/world.glb", "/media/ledgerwick/5.svg", f"/media/{PROBE_UNKNOWN}/1.svg", "/scenes/ledgerwick/scene.glb"]:
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, path
    down = os.environ["APP_MINIO_DOWN_URL"]
    for path in ["/scenes/ledgerwick/world.glb", "/media/ledgerwick/1.svg"]:
        r = httpx.get(down + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and r.json() == {"error": "file_unavailable"}, path
    with opened(browser, down + "/work/ledgerwick") as page:
        click(btn(page, f"Open image 1 of 4: {CAPTIONS['ledgerwick'][0]}"))
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        expect(dialog.get_by_text("Image unavailable", exact=True)).to_be_visible()
        expect(dialog).to_contain_text(CAPTIONS["ledgerwick"][0])


@pytest.mark.parametrize("slug", WORLD_IDS, ids=WORLD_IDS)
def test_world_pages(browser: Browser, app_url: str, slug: str) -> None:
    w = project(slug)
    k = world_index(slug)
    with opened(browser, f"{app_url}/worlds/{slug}") as page:
        article = page.locator(f'[data-world="{slug}"]')
        expect(article).to_be_visible()
        assert article.evaluate("e => getComputedStyle(e).backgroundColor") == rgb(w["ground"])
        assert article.evaluate("e => getComputedStyle(e).color") == rgb(w["ink"])
        h1 = heading(article, w["name"], 1)
        expect(h1).to_be_visible()
        assert first_family(h1) == w["face"]
        expect(article.get_by_text(meta_line(w), exact=True)).to_be_visible()
        expect(article).to_contain_text(WORLD_COPY[slug]["overview"])
        assert texts(article.get_by_role("heading", level=2)) == ["Overview", "Visual identity", "Design decisions", "Deliverables"]
        for label, value in [("Ground", w["ground"]), ("Ink", w["ink"]), ("Accent", w["accent"])]:
            swatch = article.get_by_text(f"{label} #{value}", exact=True)
            expect(swatch).to_be_visible()
            assert swatch.evaluate(SWATCH_JS, rgb(value)), f"swatch {label} is not drawn in #{value}"
        expect(article.get_by_text(f"Display face: {w['face']}", exact=True)).to_be_visible()
        assert texts(article.get_by_role("heading", level=3)) == WORLD_COPY[slug]["decisions"]
        for d in DELIVERABLES[slug]:
            expect(article.get_by_text(d, exact=True)).to_be_visible()
        assert href_path(lnk(article, "Read the full case study")) == f"/work/{slug}"
        if k > 1:
            assert href_path(lnk(article, f"Previous world: {WORLDS[k - 2]['name']}")) == f"/worlds/{WORLDS[k - 2]['slug']}"
        if k < WORLD_COUNT:
            assert href_path(lnk(article, f"Next world: {WORLDS[k]['name']}")) == f"/worlds/{WORLDS[k]['slug']}"
        expect(btn(article, "Back to all worlds")).to_be_visible()
        assert sattr(page, "active-world") == slug
        band = stage(page).bounding_box()
        assert band and abs(band["height"] - STAGE_BAND * H_DESKTOP) <= 2 * SCROLL_TOL_PX
        expect(rail(page)).to_have_count(0)
        expect(btn(page, "Next world")).to_have_count(0)
        expect(btn(page, f"Enter {w['name']}")).to_have_count(0)


def test_services_tabs(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/services") as page:
        tablist = page.get_by_role("tablist", name="Services", exact=True)
        assert texts(tablist.get_by_role("tab")) == [n for _, n in SERVICES]
        tab = lambda n: tablist.get_by_role("tab", name=n, exact=True)
        expect(tab("Brand identity")).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel", name="Brand identity", exact=True)).to_be_visible()
        length = page.evaluate("() => history.length")
        click(tab("Packaging"))
        expect(tab("Packaging")).to_have_attribute("aria-selected", "true")
        expect(page).to_have_url(re.compile(r"/services/packaging$"))
        for key, sid in [("ArrowRight", "business-applications"), ("ArrowRight", "social-content"), ("ArrowRight", "brand-identity"), ("ArrowLeft", "social-content"), ("Home", "brand-identity"), ("End", "social-content")]:
            page.keyboard.press(key)
            t = tab(SERVICE_NAME[sid])
            expect(t).to_be_focused()
            expect(t).to_have_attribute("aria-selected", "true")
            expect(page.get_by_role("tabpanel", name=SERVICE_NAME[sid], exact=True)).to_be_visible()
            expect(page).to_have_url(re.compile(f"/services/{sid}$"))
        assert page.evaluate("() => history.length") == length, "tab selection must replace the address"
        page.goto(app_url + "/services/shopify-stores")
        expect(tab("Shopify stores")).to_have_attribute("aria-selected", "true")
        assert not focused(tab("Shopify stores")), "a direct load must not move focus"
        page.set_viewport_size({"width": W_PHONE, "height": H_PHONE})
        tap(tab("Framer websites"))
        expect(tab("Framer websites")).to_have_attribute("aria-selected", "true")
        expect(page).to_have_url(re.compile(r"/services/framer-websites$"))


def test_service_panels(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/services") as page:
        for sid, sname in SERVICES:
            page.goto(f"{app_url}/services/{sid}")
            copy = SERVICE_COPY[sid]
            panel = page.get_by_role("tabpanel", name=sname, exact=True)
            expect(heading(panel, sname, 2)).to_be_visible()
            expect(panel.get_by_text(copy["purpose"], exact=True)).to_be_visible()
            for h in ["Deliverables", "Process", "Examples"]:
                expect(heading(panel, h, 3)).to_be_visible()
            for d in copy["deliverables"]:
                expect(panel.get_by_text(d, exact=True).first).to_be_visible()
            for i, (step, text) in enumerate(copy["steps"], 1):
                expect(btn(panel, f"{i}. {step}")).to_have_attribute("aria-expanded", "false")
                expect(panel.get_by_text(text, exact=True)).to_be_hidden()
            s1, s2 = btn(panel, f"1. {copy['steps'][0][0]}"), btn(panel, f"2. {copy['steps'][1][0]}")
            click(s1)
            click(s2)
            expect(s1).to_have_attribute("aria-expanded", "true")
            expect(s2).to_have_attribute("aria-expanded", "true")
            expect(panel.get_by_text(copy["steps"][0][1], exact=True)).to_be_visible()
            expect(panel.get_by_text(copy["steps"][1][1], exact=True)).to_be_visible()
            click(s1)
            expect(s1).to_have_attribute("aria-expanded", "false")
            expect(panel.get_by_text(copy["steps"][0][1], exact=True)).to_be_hidden()
            expected = [p for p in PROJECTS if sid in p["services"]]
            names = [p["name"] for p in PROJECTS]
            assert [t for t in texts(panel.get_by_role("link")) if t in names] == [p["name"] for p in expected]
            for p in expected:
                assert href_path(lnk(panel, p["name"])) == f"/work/{p['slug']}"
            work = lnk(panel, f"See all {sname} work")
            assert href_path(work) == "/work" and href_query(work) == {"service": [sid]}
            prices = lnk(panel, f"See {sname} prices")
            assert href_path(prices) == "/pricing" and href_query(prices) == {"category": [sid]}
            enq = lnk(panel, f"Enquire about {sname}")
            assert href_path(enq) == "/contact" and href_query(enq) == {"service": [sid]}


def project_names(slugs: list[str]) -> list[str]:
    return [project(s)["name"] for s in slugs]


def test_work_filters_counts(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work") as page:
        results = page.get_by_role("status", name="Results", exact=True)
        expect(results).to_have_text("")
        for label in ["Brand identity (7)", "Framer websites (4)", "Shopify stores (3)", "Packaging (3)", "Business applications (3)", "Social and content (4)"]:
            expect(btn(service_group(page), label)).to_have_attribute("aria-pressed", "false")
        assert industry_options(page)[0] == "All industries (12)"
        click(svc_btn(page, "Packaging"))
        click(svc_btn(page, "Shopify stores"))
        expect(svc_btn(page, "Packaging")).to_have_attribute("aria-pressed", "true")
        expect(results).to_have_text("3 projects match")
        assert texts(tiles(page)) == project_names(["monsoon-crate", "neem-nectar", "tiffin-theory"])
        opts = industry_options(page)
        expected = {"Finance and professional services (0)", "Food, coffee and hospitality (1)", "Architecture and real estate (0)", "Technology and software (0)", "Lifestyle and personal care (1)", "Film and creative production (0)", "Consumer products (1)", "Experimental (0)"}
        assert opts[0] == "All industries (3)" and set(opts[1:]) == expected
        click(btn(page, "Clear filters"))
        expect(btn(page, "Clear filters")).to_have_count(0)
        click(svc_btn(page, "Brand identity"))
        select(industry_box(page), "Food, coffee and hospitality (2)")
        expect(results).to_have_text("2 projects match")
        assert texts(tiles(page)) == project_names(["monsoon-crate", "saltpan-kitchen"])
        for label in ["Brand identity (2)", "Framer websites (0)", "Shopify stores (1)", "Packaging (1)", "Business applications (0)", "Social and content (1)"]:
            expect(btn(service_group(page), label)).to_be_visible()
        click(btn(page, "Clear filters"))
        click(svc_btn(page, "Business applications"))
        click(svc_btn(page, "Framer websites"))
        select(industry_box(page), "Technology and software (2)")
        expect(results).to_have_text("2 projects match")
        assert texts(tiles(page)) == project_names(["quillstack", "relaywise"])
        click(btn(page, "Clear filters"))
        click(svc_btn(page, "Framer websites"))
        select(industry_box(page), "Finance and professional services (1)")
        expect(results).to_have_text("1 project matches")
        click(btn(page, "Clear filters"))
        click(svc_btn(page, "Social and content"))
        select(industry_box(page), "Finance and professional services (0)")
        expect(results).to_have_text("No projects match these filters.")
        expect(page.get_by_role("list", name="Projects", exact=True).get_by_role("listitem")).to_have_count(0)
        click(btn(page, "Show all projects"))
        expect(svc_btn(page, "Social and content")).to_have_attribute("aria-pressed", "false")
        assert industry_selected(page) == "All industries (12)"
        expect(tiles(page)).to_have_count(PAGE_SIZE)


def test_show_more_work(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work") as page:
        assert texts(tiles(page)) == [p["name"] for p in PROJECTS[:PAGE_SIZE]]
        expect(page.get_by_text("Showing 6 of 12", exact=True)).to_be_visible()
        click(btn(page, "Show more work"))
        assert texts(tiles(page)) == [p["name"] for p in PROJECTS]
        first_new = lnk(tiles(page).page if False else page.get_by_role("list", name="Projects", exact=True), PROJECTS[PAGE_SIZE]["name"])
        expect(first_new).to_be_focused()
        assert_clear(page, first_new, "first new tile")
        expect(page.get_by_text("Showing 12 of 12", exact=True)).to_be_visible()
        expect(btn(page, "Show more work")).to_have_count(0)
        page.goto(app_url + "/work?service=brand-identity")
        page1 = project_names(["ledgerwick", "monsoon-crate", "basalt-beam", "reelhouse", "static-bloom", "saltpan-kitchen"])
        assert texts(tiles(page)) == page1
        expect(page.get_by_text("Showing 6 of 7", exact=True)).to_be_visible()
        click(btn(page, "Show more work"))
        assert texts(tiles(page)) == page1 + ["Relaywise"]
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Relaywise")).to_be_focused()
        expect(btn(page, "Show more work")).to_have_count(0)


def test_gallery_address_return(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work") as page:
        length = page.evaluate("() => history.length")
        click(svc_btn(page, "Packaging"))
        click(svc_btn(page, "Shopify stores"))
        assert url_query(page) == {"service": ["shopify-stores,packaging"]}
        select(industry_box(page), "Food, coffee and hospitality (1)")
        assert url_query(page) == {"service": ["shopify-stores,packaging"], "industry": ["food"]}
        assert page.evaluate("() => history.length") == length, "filter changes must replace the address"
        page.goto(app_url + "/work")
        click(btn(page, "Show more work"))
        assert url_query(page) == {"pages": ["2"]}
        page.goto(app_url + "/work?service=brand-identity&pages=2")
        expect(svc_btn(page, "Brand identity")).to_have_attribute("aria-pressed", "true")
        expect(tiles(page)).to_have_count(7)
        expect(page.get_by_role("status", name="Results", exact=True)).to_have_text("")
        page.goto(f"{app_url}/work?service={PROBE_UNKNOWN}&industry={PROBE_UNKNOWN}&pages={PROBE_UNKNOWN}")
        expect(tiles(page)).to_have_count(PAGE_SIZE)
        assert industry_selected(page) == "All industries (12)"
        gallery = app_url + "/work?service=brand-identity&pages=2"
        page.goto(gallery)
        projects_list = page.get_by_role("list", name="Projects", exact=True)
        click(lnk(projects_list, "Relaywise"))
        expect(page).to_have_url(re.compile(r"/work/relaywise$"))
        page.go_back()
        assert url_path(page) == "/work" and url_query(page) == {"service": ["brand-identity"], "pages": ["2"]}
        tile = lnk(page.get_by_role("list", name="Projects", exact=True), "Relaywise")
        expect(tile).to_be_focused()
        assert_clear(page, tile, "returned tile")
        click(tile)
        all_work = lnk(page.get_by_role("main"), "All work")
        assert href_path(all_work) == "/work" and href_query(all_work) == {"service": ["brand-identity"], "pages": ["2"]}
        click(all_work)
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Relaywise")).to_be_focused()
    with opened(browser, app_url + "/work/ledgerwick") as page:
        all_work = lnk(page.get_by_role("main"), "All work")
        assert href_path(all_work) == "/work" and href_query(all_work) == {}


def api_projects(app_url: str, **params: Any) -> httpx.Response:
    return httpx.get(f"{app_url}/api/projects", params=params, timeout=HTTP_TIMEOUT)


def test_projects_api_paging(app_url: str) -> None:
    r = api_projects(app_url)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == PROJECT_COUNT and [i["slug"] for i in data["items"]] == [p["slug"] for p in PROJECTS[:PAGE_SIZE]] and data["next_offset"] == PAGE_SIZE
    item = data["items"][0]
    assert item["name"] == "Ledgerwick Advisory" and item["industry_id"] == "finance" and item["industry"] == INDUSTRIES["finance"]
    assert item["services"] == ["brand-identity", "framer-websites"] and item["world_slug"] == "ledgerwick"
    rest = api_projects(app_url, offset=PAGE_SIZE).json()
    assert [i["slug"] for i in rest["items"]] == [p["slug"] for p in PROJECTS[PAGE_SIZE:]] and rest["next_offset"] is None
    assert all(i["world_slug"] is None for i in rest["items"] if i["slug"] in {"copperline", "saltpan-kitchen", "courtyard-homes", "relaywise"})
    assert len(api_projects(app_url, limit=100).json()["items"]) == PAGE_SIZE, "limit must be capped at WORK_PAGE_SIZE"
    part = api_projects(app_url, offset=3, limit=2).json()
    assert [i["slug"] for i in part["items"]] == ["quillstack", "neem-nectar"] and part["next_offset"] == 5
    collected: list[str] = []
    offset: int | None = 0
    for _ in range(10):
        if offset is None:
            break
        page_ = api_projects(app_url, service="brand-identity", offset=offset, limit=2).json()
        assert page_["total"] == 7
        collected += [i["slug"] for i in page_["items"]]
        offset = page_["next_offset"]
    assert collected == [p["slug"] for p in PROJECTS if "brand-identity" in p["services"]], "paging must give every match once in gallery order"
    assert [i["slug"] for i in api_projects(app_url, service="packaging,shopify-stores").json()["items"]] == ["monsoon-crate", "neem-nectar", "tiffin-theory"]
    assert [i["slug"] for i in api_projects(app_url, service="brand-identity", industry="food").json()["items"]] == ["monsoon-crate", "saltpan-kitchen"]
    assert api_projects(app_url, service=PROBE_UNKNOWN, industry=PROBE_UNKNOWN).json()["total"] == PROJECT_COUNT
    end = api_projects(app_url, offset=PROJECT_COUNT).json()
    assert end["items"] == [] and end["next_offset"] is None
    for bad in ["-1", "abc"]:
        r = api_projects(app_url, offset=bad)
        assert r.status_code == 422 and r.json() == {"errors": {"offset": "Must be a whole number of 0 or more."}}
    r = api_projects(app_url, limit=0)
    assert r.status_code == 422 and r.json() == {"errors": {"limit": "Must be a whole number of 1 or more."}}
    assert httpx.head(f"{app_url}/api/projects", timeout=HTTP_TIMEOUT).status_code == 200


CASE_H2 = ["The brief", "Brand strategy", "Identity", "Typography", "Colour", "Digital design", "Implementation", "Gallery", "Deliverables"]


def test_case_studies(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work") as page:
        for i, p in enumerate(PROJECTS):
            slug = p["slug"]
            page.goto(f"{app_url}/work/{slug}")
            main = page.get_by_role("main")
            h1 = heading(main, p["name"], 1)
            expect(h1).to_be_visible()
            assert first_family(h1) == p["face"]
            assert h1.evaluate(GROUND_JS) == rgb(p["ground"])
            assert h1.evaluate("e => getComputedStyle(e).color") == rgb(p["ink"])
            expect(main.get_by_text(meta_line(p), exact=True)).to_be_visible()
            assert texts(main.get_by_role("heading", level=2)) == CASE_H2
            expect(main).to_contain_text(BRIEFS[slug])
            expect(main.get_by_text(f"Display face: {p['face']}", exact=True)).to_be_visible()
            expect(main.get_by_text("Body face: Figtree", exact=True)).to_be_visible()
            for label, value in [("Ground", p["ground"]), ("Ink", p["ink"]), ("Accent", p["accent"])]:
                sw = main.get_by_text(f"{label} #{value}", exact=True)
                expect(sw).to_be_visible()
                assert sw.evaluate(SWATCH_JS, rgb(value))
            for n, caption in enumerate(CAPTIONS[slug], 1):
                expect(btn(main, f"Open image {n} of 4: {caption}")).to_be_visible()
            for d in DELIVERABLES[slug]:
                expect(main.get_by_text(d, exact=True).first).to_be_visible()
            visit = lnk(main, "Visit the world")
            if i < WORLD_COUNT:
                assert href_path(visit) == f"/worlds/{slug}"
            else:
                expect(visit).to_have_count(0)
            prev_p, next_p = PROJECTS[i - 1], PROJECTS[(i + 1) % len(PROJECTS)]
            assert href_path(lnk(main, f"Previous project: {prev_p['name']}")) == f"/work/{prev_p['slug']}"
            assert href_path(lnk(main, f"Next project: {next_p['name']}")) == f"/work/{next_p['slug']}"
            expect(lnk(main, "All work")).to_be_visible()
            api = httpx.get(f"{app_url}/api/projects/{slug}", timeout=HTTP_TIMEOUT).json()
            assert api["previous"]["slug"] == prev_p["slug"] and api["next"]["slug"] == next_p["slug"]
            assert [g["caption"] for g in api["gallery"]] == CAPTIONS[slug]
            assert [g["src"] for g in api["gallery"]] == [f"/media/{slug}/{n}.svg" for n in range(1, 5)]
            assert api["display_face"] == p["face"] and api["body_face"] == "Figtree"
            assert api["sections"]["brief"] == BRIEFS[slug] and api["deliverables"] == DELIVERABLES[slug]
            assert api["colours"]["ground"].lstrip("#").upper() == p["ground"]
    r = httpx.get(f"{app_url}/api/projects/{PROBE_UNKNOWN}", timeout=HTTP_TIMEOUT)
    assert r.status_code == 404 and r.json() == {"error": "not_found"}


def test_image_viewer(browser: Browser, app_url: str) -> None:
    caps = CAPTIONS["monsoon-crate"]
    with opened(browser, app_url + "/work/monsoon-crate") as page:
        thumb2 = btn(page, f"Open image 2 of 4: {caps[1]}")
        click(thumb2)
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        expect(dialog).to_be_visible()
        assert dialog.evaluate(MODAL_JS), "Image viewer must be modal"
        close = btn(dialog, "Close viewer")
        expect(close).to_be_focused()

        def shows(n: int) -> None:
            expect(dialog).to_contain_text(f"Image {n} of 4")
            expect(dialog).to_contain_text(caps[n - 1])
            img = dialog.get_by_role("img", name=caps[n - 1], exact=True)
            expect(img).to_be_visible()
            assert urlparse(img.get_attribute("src") or "").path == f"/media/monsoon-crate/{n}.svg"

        shows(2)
        click(btn(dialog, "Next image"))
        shows(3)
        close.focus()
        page.keyboard.press("ArrowRight")
        shows(4)
        page.keyboard.press("ArrowRight")
        shows(1)
        click(btn(dialog, "Previous image"))
        shows(4)
        page.keyboard.press("ArrowLeft")
        shows(3)
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} escaped the viewer"
        settle_viewer(page)
        img = dialog.get_by_role("img", name=caps[2], exact=True)
        box = img.bounding_box()
        assert box is not None
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        swipe(page, cx, cy, -PROBE_DRAG_LONG)
        shows(4)
        settle_viewer(page)
        swipe(page, cx, cy, -PROBE_SHORT_SWIPE)
        shows(4)
        swipe(page, cx, cy, PROBE_DRAG_LONG)
        shows(3)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(thumb2).to_be_focused()
        thumb4 = btn(page, f"Open image 4 of 4: {caps[3]}")
        click(thumb4)
        click(btn(page.get_by_role("dialog", name="Image viewer", exact=True), "Close viewer"))
        expect(thumb4).to_be_focused()


def test_price_list_items(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/pricing") as page:
        expect(heading(page, "Price list", 1)).to_be_visible()
        expect(page.get_by_text("Illustrative prices in Indian rupees for a fictional studio. They are not a quote and not any real studio's published prices.", exact=True)).to_be_visible()
        assert price_names(page) == [row[2] for row in PRICES]
        for pid, cat, name, typ, price, delivery, revisions, inclusions in PRICES:
            art = price_article(page, name)
            expect(art).to_have_count(1)
            for t in [TYPE_BADGE[typ], price, f"Delivery: {delivery}", f"Revisions: {revisions}"]:
                expect(art.get_by_text(t, exact=True)).to_be_visible()
            details = btn(art, f"Details for {name}")
            expect(details).to_have_attribute("aria-expanded", "false")
            expect(lnk(art, f"Enquire about {name}")).to_have_count(0)
            click(details)
            expect(details).to_have_attribute("aria-expanded", "true")
            for inc in inclusions:
                expect(art.get_by_text(inc, exact=True)).to_be_visible()
            expect(art.get_by_text(PAYMENT_LINE[typ], exact=True)).to_be_visible()
            enq = lnk(art, f"Enquire about {name}")
            assert href_path(enq) == "/contact" and href_query(enq) == {"service": [cat], "item": [pid]}
        opened_count = page.get_by_role("main").get_by_role("button", name=re.compile("^Details for ")).evaluate_all("els => els.filter(e => e.getAttribute('aria-expanded') === 'true').length")
        assert opened_count == PRICE_COUNT
        first = btn(price_article(page, "Logo and wordmark"), "Details for Logo and wordmark")
        click_clear(first)
        expect(first).to_have_attribute("aria-expanded", "false")
        expect(btn(price_article(page, "Campaign content"), "Details for Campaign content")).to_have_attribute("aria-expanded", "true")
    api = httpx.get(f"{app_url}/api/prices", timeout=HTTP_TIMEOUT).json()["items"]
    assert [(i["id"], i["category"], i["name"], i["type"], i["price_text"], i["inclusions"]) for i in api] == [(r[0], r[1], r[2], r[3], r[4], r[7]) for r in PRICES]


def test_price_filters(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/pricing") as page:
        status = page.get_by_role("status", name="Price results", exact=True)
        expect(status).to_have_text("")
        for label in ["All (14)", "Brand identity (3)", "Framer websites (2)", "Shopify stores (2)", "Packaging (2)", "Business applications (2)", "Social and content (3)"]:
            expect(category_radio(page, label)).to_have_count(1)
        for label in ["All types (14)", "Fixed price (9)", "Custom quote (5)"]:
            expect(type_radio(page, label)).to_have_count(1)
        logo = btn(price_article(page, "Logo and wordmark"), "Details for Logo and wordmark")
        click(logo)
        check(category_radio(page, "Social and content (3)"))
        expect(status).to_have_text("Showing 3 of 14 items")
        for label in ["All types (3)", "Fixed price (2)", "Custom quote (1)"]:
            expect(type_radio(page, label)).to_have_count(1)
        assert url_query(page) == {"category": ["social-content"]}
        check(category_radio(page, "All (14)"))
        check(type_radio(page, "Custom quote (5)"))
        expect(status).to_have_text("Showing 5 of 14 items")
        expect(category_radio(page, "All (5)")).to_have_count(1)
        expect(category_radio(page, "Framer websites (0)")).to_have_count(1)
        for label in ["Brand identity (1)", "Shopify stores (1)", "Packaging (1)", "Business applications (1)", "Social and content (1)"]:
            expect(category_radio(page, label)).to_have_count(1)
        assert url_query(page) == {"type": ["custom"]}
        check(type_radio(page, "All types (14)"))
        expect(btn(price_article(page, "Logo and wordmark"), "Details for Logo and wordmark")).to_have_attribute("aria-expanded", "true")
        check(category_radio(page, "Brand identity (3)"))
        check(type_radio(page, "Fixed price (2)"))
        expect(status).to_have_text("Showing 2 of 14 items")
        assert price_names(page) == ["Logo and wordmark", "Brand guidelines book"]
        expect(category_radio(page, "All (9)")).to_have_count(1)
        category_radio(page, "Brand identity (2)").focus()
        page.keyboard.press("ArrowDown")
        expect(category_radio(page, "Framer websites (2)")).to_be_checked()
        expect(status).to_have_text("Showing 2 of 14 items")
        check(type_radio(page, "Custom quote (0)"))
        expect(status).to_have_text("No items match these filters.")
        click(btn(page, "Show all items"))
        expect(category_radio(page, "All (14)")).to_be_checked()
        expect(type_radio(page, "All types (14)")).to_be_checked()
        assert len(price_names(page)) == PRICE_COUNT and url_query(page) == {}
        page.goto(app_url + "/pricing?category=brand-identity&type=fixed")
        expect(category_radio(page, "Brand identity (2)")).to_be_checked()
        expect(type_radio(page, "Fixed price (2)")).to_be_checked()
        assert price_names(page) == ["Logo and wordmark", "Brand guidelines book"]
        page.goto(f"{app_url}/pricing?category={PROBE_UNKNOWN}&type={PROBE_UNKNOWN}")
        expect(category_radio(page, "All (14)")).to_be_checked()
        assert len(price_names(page)) == PRICE_COUNT


def test_studio_page(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        main = page.get_by_role("main")
        expect(heading(main, "The studio", 1)).to_be_visible()
        expect(main.get_by_text("Two founders, two designers, one room in Kochi. We take on six projects a season so each one gets our full attention.", exact=True)).to_be_visible()
        for h in ["What we care about", "The people", "How a project runs"]:
            expect(heading(main, h, 2)).to_be_visible()
        for name, text in PRINCIPLES:
            expect(heading(main, name, 3)).to_be_visible()
            expect(main.get_by_text(text, exact=True)).to_be_visible()
        boxes = [heading(main, n, 3).bounding_box() for n, _ in PRINCIPLES]
        assert len({round(b["x"]) for b in boxes if b}) == 2 and len({round(b["y"]) for b in boxes if b}) == 2, "principles must sit two by two at 1280"
        for name, role, line in PEOPLE:
            for t in [name, role, line]:
                expect(main.get_by_text(t, exact=True).first).to_be_visible()
        items = main.get_by_role("list").filter(has_text=STAGES[0][1]).first.get_by_role("listitem")
        got = texts(items)
        assert len(got) == len(STAGES) and all(n in g and line in g for (n, line), g in zip(STAGES, got)), f"stages {got}"
        assert href_path(lnk(main, "See the price list")) == "/pricing"
        assert href_path(lnk(main, "Start a project")) == "/contact"
        page.set_viewport_size({"width": W_PHONE, "height": H_PHONE})
        boxes = [heading(main, n, 3).bounding_box() for n, _ in PRINCIPLES]
        assert len({round(b["x"]) for b in boxes if b}) == 1 and [b["y"] for b in boxes] == sorted(b["y"] for b in boxes), "principles must stack in one column at 375"


def test_questions_accordion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/faq") as page:
        main = page.get_by_role("main")
        expect(heading(main, "Questions and answers", 1)).to_be_visible()
        assert texts(main.get_by_role("heading", level=2)) == [q for _, q, _ in QUESTIONS]
        qb = [btn(main, q) for _, q, _ in QUESTIONS]
        for b, (_, q, _a) in zip(qb, QUESTIONS):
            expect(b).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("region", name=q, exact=True)).to_have_count(0)
        click(qb[0])
        expect(qb[0]).to_have_attribute("aria-expanded", "true")
        region = page.get_by_role("region", name=QUESTIONS[0][1], exact=True)
        expect(region).to_contain_text(QUESTIONS[0][2])
        qb[0].focus()
        page.keyboard.press("ArrowDown")
        expect(qb[1]).to_be_focused()
        expect(qb[1]).to_have_attribute("aria-expanded", "false")
        page.keyboard.press("Enter")
        expect(qb[1]).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("Space")
        expect(qb[1]).to_have_attribute("aria-expanded", "false")
        for key, idx in [("ArrowUp", 0), ("ArrowUp", 7), ("ArrowDown", 0), ("End", 7), ("Home", 0), ("End", 7)]:
            page.keyboard.press(key)
            expect(qb[idx]).to_be_focused()
        page.keyboard.press("Enter")
        expect(qb[7]).to_have_attribute("aria-expanded", "true")
        expect(qb[0]).to_have_attribute("aria-expanded", "true")
        page.goto(app_url + "/faq?open=pricing")
        b = btn(page.get_by_role("main"), "How are prices set?")
        expect(b).to_have_attribute("aria-expanded", "true")
        expect(b).to_be_focused()
        expect(page.get_by_role("region", name="How are prices set?", exact=True)).to_contain_text("All prices on this site are illustrative.")
        page.set_viewport_size({"width": W_PHONE, "height": H_PHONE})
        tap(btn(page.get_by_role("main"), QUESTIONS[4][1]))
        expect(btn(page.get_by_role("main"), QUESTIONS[4][1])).to_have_attribute("aria-expanded", "true")


def step_item(page: Page, name: str) -> Locator:
    return page.get_by_role("list", name="Enquiry steps", exact=True).get_by_role("listitem").filter(has_text=name)


def test_enquiry_steps_draft(browser: Browser, app_url: str) -> None:
    name, email = visitor("steps")
    with opened(browser, app_url + "/contact?service=packaging&item=pack-range") as page:
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        expect(step_item(page, "Your project")).to_have_attribute("aria-current", "step")
        expect(page.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        expect_attached(page, "Packaging range")
        click(btn(page, "Back"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        expect(step_item(page, "About you")).to_have_attribute("aria-current", "step")
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        expect(step_item(page, "Your project")).to_have_attribute("aria-current", "step")
        service = page.get_by_role("radiogroup", name="Service", exact=True)
        expect(service.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        expect_attached(page, "Packaging range")
        expect(btn(page, "Remove item")).to_be_visible()
        fill(textbox(page, "Project description"), EX_DESCRIPTION)
        click(btn(page, "Next"))
        expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
        check(page.get_by_role("radio", name="Not sure yet", exact=True))
        click(btn(page, "Next"))
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_focused()
        expect(step_item(page, "Review")).to_have_attribute("aria-current", "step")
        expected = {"Name": name, "Email": email, "Business name": EX_BUSINESS, "Service": "Packaging", "Enquiring about": "Packaging range", "Project description": EX_DESCRIPTION, "Approximate budget": "Not sure yet"}
        assert review(page) == expected
        click(btn(page, "Edit your project"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        expect(textbox(page, "Project description")).to_have_value(EX_DESCRIPTION)
        click(btn(page, "Next"))
        expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
        expect(page.get_by_role("radio", name="Not sure yet", exact=True)).to_be_checked()
        click(btn(page, "Back"))
        click(btn(page, "Back"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        expect(textbox(page, "Name")).to_have_value(name)
        click(btn(page, "Next"))
        page.reload()
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        expect(textbox(page, "Project description")).to_have_value(EX_DESCRIPTION)
        click(lnk(page.get_by_role("contentinfo"), "Studio"))
        expect(page).to_have_url(re.compile(r"/studio$"))
        page.go_back()
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        expect(page.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        click(btn(page, "Remove item"))
        expect(attached(page)).to_have_count(0)
        other = page.context.new_page()
        other.goto(app_url + "/contact")
        expect(other.get_by_role("textbox", name="Name", exact=True)).to_have_value("")
        other.close()
    with opened(browser, app_url + "/contact?service=packaging&item=pack-range") as page:
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        click(btn(page, "Back"))
        to_review(page, name, email)
        click(btn(page, "Edit your project"))
        check(page.get_by_role("radio", name="Brand identity", exact=True))
        expect(attached(page)).to_have_count(0)
    with opened(browser, app_url + "/contact?service=packaging&item=logo-wordmark") as page:
        to_step_one(page, "Packaging")
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(page.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        expect(attached(page)).to_have_count(0)


def assert_invalid(page: Page, loc: Locator, message: str) -> None:
    expect(loc).to_have_attribute("aria-invalid", "true")
    assert message in loc.evaluate(DESCRIBED_JS), f"expected {message!r} linked by aria-describedby"


def test_enquiry_validation(browser: Browser, app_url: str) -> None:
    name, email = visitor("valid")
    with opened(browser, app_url + "/contact") as page:
        click(btn(page, "Next"))
        assert_invalid(page, textbox(page, "Name"), "Enter your name.")
        assert_invalid(page, textbox(page, "Email"), "Enter your email address.")
        assert_invalid(page, textbox(page, "Business name"), "Enter your business name.")
        expect(textbox(page, "Name")).to_be_focused()
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_visible()
        fill(textbox(page, "Name"), name)
        expect(page.get_by_text("Enter your name.", exact=True)).to_have_count(0)
        fill(textbox(page, "Email"), PROBE_BAD_EMAIL)
        click(btn(page, "Next"))
        assert_invalid(page, textbox(page, "Email"), "Enter an email address like name@example.com.")
        expect(textbox(page, "Email")).to_be_focused()
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Name"), "a" * (NAME_MAX + 1))
        fill(textbox(page, "Business name"), "b" * (BUSINESS_MAX + 1))
        click(btn(page, "Next"))
        assert_invalid(page, textbox(page, "Name"), "Keep your name to 80 characters or fewer.")
        assert_invalid(page, textbox(page, "Business name"), "Keep your business name to 120 characters or fewer.")
        expect(textbox(page, "Name")).to_be_focused()
        fill(textbox(page, "Name"), "🌿" * NAME_MAX)
        fill(textbox(page, "Business name"), "b" * BUSINESS_MAX)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        click(btn(page, "Next"))
        group = page.get_by_role("radiogroup", name="Service", exact=True)
        assert_invalid(page, group, "Choose a service.")
        expect(group.get_by_role("radio", name="Brand identity", exact=True)).to_be_focused()
        assert group.get_by_role("radio").evaluate_all("els => els.filter(e => e.checked || e.getAttribute('aria-checked') === 'true').length") == 0
        assert_invalid(page, textbox(page, "Project description"), "Describe your project in at least 30 characters.")
        check(group.get_by_role("radio", name="Social and content", exact=True))
        expect(group).not_to_have_attribute("aria-invalid", "true")
        short = "  " + "d" * (DESC_MIN - 1) + "  "
        fill(textbox(page, "Project description"), short)
        expect(page.get_by_text(f"{len(short)} / 1,200 characters", exact=True)).to_be_visible()
        click(btn(page, "Next"))
        assert_invalid(page, textbox(page, "Project description"), "Describe your project in at least 30 characters.")
        expect(textbox(page, "Project description")).to_be_focused()
        fill(textbox(page, "Project description"), "d" * (DESC_MAX + 1))
        expect(page.get_by_text("1,201 / 1,200 characters", exact=True)).to_be_visible()
        click(btn(page, "Next"))
        assert_invalid(page, textbox(page, "Project description"), "Keep your description to 1,200 characters or fewer.")
        fill(textbox(page, "Project description"), "🌿" * DESC_MIN)
        expect(page.get_by_text("30 / 1,200 characters", exact=True)).to_be_visible()
        click(btn(page, "Next"))
        expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
        click(btn(page, "Next"))
        budget = page.get_by_role("radiogroup", name="Approximate budget", exact=True)
        assert_invalid(page, budget, "Choose an approximate budget.")
        expect(budget.get_by_role("radio", name="Under ₹50,000", exact=True)).to_be_focused()
        check(budget.get_by_role("radio", name="Above ₹5,00,000", exact=True))
        expect(page.get_by_text("Choose an approximate budget.", exact=True)).to_have_count(0)
        click(btn(page, "Next"))
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_focused()


FIELD_CASES = [
    ("name", "   ", "Enter your name."),
    ("name", 123, "Enter your name."),
    ("name", "a" * (NAME_MAX + 1), "Keep your name to 80 characters or fewer."),
    ("email", "", "Enter your email address."),
    ("business_name", " ", "Enter your business name."),
    ("business_name", "b" * (BUSINESS_MAX + 1), "Keep your business name to 120 characters or fewer."),
    ("service", PROBE_UNKNOWN, "Choose a service."),
    ("description", " " + "d" * (DESC_MIN - 1) + " ", "Describe your project in at least 30 characters."),
    ("description", "🌿" * (DESC_MAX + 1), "Keep your description to 1,200 characters or fewer."),
    ("budget", PROBE_UNKNOWN, "Choose an approximate budget."),
    ("item", "logo-wordmark", "Choose an item from the chosen service."),
    ("submission_id", "not-a-uuid", "Missing submission id."),
    ("submission_id", str(uuid.uuid1()), "Missing submission id."),
]


def test_enquiry_request_checks(app_url: str, wiremock: Any) -> None:
    url = f"{app_url}/api/enquiries"
    refused: list[str] = []
    e = email_of("ct")
    refused.append(e)
    r = httpx.post(url, content=json.dumps(enquiry(e)), headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    big = json.dumps(enquiry(e))
    r = httpx.post(url, content=big + " " * (BODY_MAX + 1 - len(big.encode())), headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 415, "content type is checked before size"
    r = httpx.post(url, content="{" + " " * BODY_MAX, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413 and r.json() == {"error": "too_large"}
    r = httpx.post(url, content=big + " " * (BODY_MAX + 1 - len(big.encode())), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413
    r = httpx.post(url, content="{", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 400 and r.json() == {"error": "invalid_json"}
    r = post(app_url, {})
    assert r.status_code == 422
    assert {"name", "email", "business_name", "service", "description", "budget", "submission_id"} <= set(r.json()["errors"])
    for field, value, message in FIELD_CASES:
        e = email_of("field")
        refused.append(e)
        body = enquiry(e)
        body[field] = value
        if field == "service":
            body["item"] = None
        r = post(app_url, body)
        assert r.status_code == 422 and r.json() == {"errors": {field: message}}, f"{field}={value!r}: {r.text}"
    e = PROBE_BAD_EMAIL
    r = post(app_url, enquiry(e))
    assert r.status_code == 422 and r.json() == {"errors": {"email": "Enter an email address like name@example.com."}}
    for e in refused:
        assert stored(app_url, e) == [], f"refused post for {e} was stored"
        assert intake_for(wiremock, e) == [], f"refused post for {e} reached the intake service"
    e = email_of("edge")
    ok = enquiry(e, name="🌿" * NAME_MAX, business_name="b" * BUSINESS_MAX, description="🌿" * DESC_MAX, item=None)
    r = httpx.post(url, content=json.dumps(ok), headers={"Content-Type": "application/json; charset=utf-8"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, r.text
    e = email_of("exact")
    raw = json.dumps(enquiry(e))
    r = httpx.post(url, content=raw + " " * (BODY_MAX - len(raw.encode())), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, "a body of exactly 16,384 bytes is allowed"
    e = email_of("extra")
    r = post(app_url, enquiry(e, status="failed", reference=PROBE_FAKE_REFERENCE, intake_reference=PROBE_INTAKE_REF, created_at=PROBE_FAKE_CREATED))
    assert r.status_code == 201
    body = r.json()
    assert body["reference"] != PROBE_FAKE_REFERENCE and body["intake_reference"] == "IN-DEMO-0001"
    rec = stored(app_url, e)[0]
    assert rec["reference"] == body["reference"] and rec["created_at"] != PROBE_FAKE_CREATED and rec["intake_state"] == "sent"


def test_intake_handoff(app_url: str, wiremock: Any) -> None:
    name, e = visitor("intake")
    spaced = f"  {name}  "
    body = enquiry(e, name=spaced)
    r = post(app_url, body)
    assert r.status_code == 201
    out = r.json()
    assert re.fullmatch(r"VO-\d{6}", out["reference"]) and out["intake_reference"] == "IN-DEMO-0001" and out["status"] == "sent"
    sent = intake_for(wiremock, e)
    assert len(sent) == 1
    assert sent[0] == {"reference": out["reference"], "name": spaced, "email": e, "business_name": EX_BUSINESS, "service": "packaging", "budget": "50k-150k", "description": EX_DESCRIPTION, "item": "pack-range", "source": "vellum-orbit-site"}
    assert any("application/json" in json.dumps(req).lower() for req in wiremock.requests(INTAKE_PATH) if e in json.dumps(req))
    rec = stored(app_url, e)
    assert len(rec) == 1
    rec0 = rec[0]
    assert rec0["intake_state"] == "sent" and rec0["intake_reference"] == "IN-DEMO-0001" and rec0["name"] == spaced and rec0["submission_id"] == body["submission_id"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)", rec0["created_at"])
    e2 = email_of("intake2")
    r2 = post(app_url, enquiry(e2))
    assert int(r2.json()["reference"][3:]) > int(out["reference"][3:]), "references increase in order"
    wiremock.stub("POST", INTAKE_PATH, status=201, json={"intake_reference": PROBE_INTAKE_REF})
    e3 = email_of("intake3")
    r3 = post(app_url, enquiry(e3))
    assert r3.status_code == 201 and r3.json()["intake_reference"] == PROBE_INTAKE_REF
    assert stored(app_url, e3)[0]["intake_reference"] == PROBE_INTAKE_REF
    failures = [
        {"status": 503, "json": {"error": PROBE_UNKNOWN}},
        {"status": 201, "json": {"intake_reference": ""}},
        {"status": 200, "json": {"intake_reference": PROBE_INTAKE_REF}},
        {"status": 201, "body": PROBE_UNKNOWN},
        {"status": 201, "json": {"intake_reference": PROBE_INTAKE_REF}, "delay_ms": INTAKE_TIMEOUT_MS + 1500},
    ]
    for stub in failures:
        wiremock.stub("POST", INTAKE_PATH, **stub)
        ef = email_of("fail")
        r = post(app_url, enquiry(ef))
        assert r.status_code == 502, f"intake answer {stub} must give 502"
        body_ = r.json()
        assert re.fullmatch(r"VO-\d{6}", body_["reference"]) and body_["status"] == "intake_failed" and body_["error"] == "intake_unavailable"
        rec = stored(app_url, ef)
        assert len(rec) == 1 and rec[0]["intake_state"] == "failed" and rec[0]["intake_reference"] is None
        assert len(intake_for(wiremock, ef)) == 1
    wiremock.fault("POST", INTAKE_PATH, "CONNECTION_RESET_BY_PEER")
    ef = email_of("reset")
    assert post(app_url, enquiry(ef)).status_code == 502
    assert stored(app_url, ef)[0]["intake_state"] == "failed"
    down = os.environ["APP_INTAKE_DOWN_URL"]
    ed = email_of("down")
    r = post(down, enquiry(ed))
    assert r.status_code == 502 and r.json()["status"] == "intake_failed"
    assert stored(down, ed)[0]["intake_state"] == "failed"


def test_one_enquiry_per_submission(app_url: str, wiremock: Any) -> None:
    e = email_of("replay")
    body = enquiry(e)
    a = post(app_url, body)
    b = post(app_url, {**body, "name": PROBE_UNKNOWN})
    assert a.status_code == b.status_code == 201 and a.json()["reference"] == b.json()["reference"] and b.json()["intake_reference"] == "IN-DEMO-0001"
    recs = stored(app_url, e)
    assert len(recs) == 1 and recs[0]["name"] == EX_NAME
    assert len(intake_for(wiremock, e)) == 1, "a replay of a sent enquiry makes no intake request"
    wiremock.stub("POST", INTAKE_PATH, status=201, json={"intake_reference": "IN-DEMO-0001"}, delay_ms=1500)
    e2 = email_of("race")
    body2 = enquiry(e2)
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: post(app_url, body2), range(5)))
    assert all(r.status_code == 201 for r in results), [r.status_code for r in results]
    assert len({r.json()["reference"] for r in results}) == 1
    assert len(stored(app_url, e2)) == 1 and len(intake_for(wiremock, e2)) == 1
    wiremock.stub("POST", INTAKE_PATH, status=503, json={"error": PROBE_UNKNOWN})
    e3 = email_of("retry")
    body3 = enquiry(e3)
    first = post(app_url, body3)
    assert first.status_code == 502
    ref = first.json()["reference"]
    baseline_intake(wiremock)
    again = post(app_url, body3)
    assert again.status_code == 201 and again.json()["reference"] == ref and again.json()["intake_reference"] == "IN-DEMO-0001"
    calls = intake_for(wiremock, e3)
    assert len(calls) == 2 and all(c["reference"] == ref for c in calls)
    recs = stored(app_url, e3)
    assert len(recs) == 1 and recs[0]["intake_state"] == "sent"
    assert post(app_url, body3).status_code == 201 and len(intake_for(wiremock, e3)) == 2
    e4 = email_of("replaylimit")
    bodies = [enquiry(e4) for _ in range(ENQUIRY_LIMIT)]
    assert all(post(app_url, x).status_code == 201 for x in bodies)
    assert post(app_url, bodies[0]).status_code == 201, "a replay is never refused by the limit"
    assert len(stored(app_url, e4)) == ENQUIRY_LIMIT


def test_enquiry_limit(app_url: str, wiremock: Any) -> None:
    e = email_of("limit")
    bad = post(app_url, enquiry(e, description="d"))
    assert bad.status_code == 422
    for _ in range(ENQUIRY_LIMIT):
        assert post(app_url, enquiry(e)).status_code == 201
    for variant in [e, e.upper()]:
        r = post(app_url, enquiry(variant))
        assert r.status_code == 429
        data = r.json()
        assert data["error"] == "rate_limited" and isinstance(data["retry_after_seconds"], int)
        assert 0 < data["retry_after_seconds"] <= WINDOW_S
        assert r.headers.get("retry-after") == str(data["retry_after_seconds"])
    assert len(stored(app_url, e)) == ENQUIRY_LIMIT
    assert len(intake_for(wiremock, e)) == ENQUIRY_LIMIT
    assert post(app_url, enquiry(email_of("other"))).status_code == 201


def test_only_published_surface(browser: Browser, app_url: str) -> None:
    bodies: list[str] = []
    for path in [f"/api/{PROBE_UNKNOWN}", "/scenes/", "/scenes/ledgerwick/", "/media/ledgerwick/", "/media/ledgerwick/0.svg", "/api/grading/enquiries"]:
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, path
        bodies.append(r.text)
    r = httpx.get(f"{app_url}/api/grading/enquiries", params={"email": EX_NAME}, headers={"X-Grading-Key": PROBE_UNKNOWN}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    server_paths = ["/package.json", "/.env", "/src/", "/node_modules/"]
    for path in server_paths:
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, path
        bodies.append(r.text)
    for method, path, allow in [("DELETE", "/api/health", {"GET", "HEAD"}), ("GET", "/api/enquiries", {"POST"}), ("PUT", "/work", {"GET", "HEAD"}), ("POST", "/scenes/ledgerwick/world.glb", {"GET", "HEAD"})]:
        r = httpx.request(method, app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 405, f"{method} {path}"
        got = {m.strip() for m in r.headers.get("allow", "").split(",") if m.strip()}
        assert allow <= got, f"{method} {path} Allow {got}"
        if path.startswith("/api/") or path.startswith("/scenes/"):
            assert r.json() == {"error": "method_not_allowed"}
        bodies.append(r.text)
    for path in ["/api/worlds", "/work"]:
        assert httpx.head(app_url + path, timeout=HTTP_TIMEOUT).status_code == 200
    r = httpx.post(f"{app_url}/api/enquiries", content="{", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    bodies.append(r.text)
    for b in bodies:
        assert not re.search(r"\n\s+at\s", b), "error body contains a stack trace"
        assert not re.search(r"(?<![\w./-])" + re.escape(str(DEPLOYED_APP)) + r"/[\w.-]+/", b), "error body contains a server file path"
        for secret in env_secrets():
            assert secret not in b, "error body reveals configuration"
    for path in ["/", "/api/worlds"]:
        header_names = " ".join(httpx.get(app_url + path, timeout=HTTP_TIMEOUT).headers.keys()).replace("-", " ").lower()
        assert "content security policy" not in header_names
    with opened(browser, app_url + "/studio") as page:
        for path in server_paths:
            resp = page.goto(app_url + path)
            assert resp is not None and resp.status == 404, path
            expect(heading(page, "This page does not exist.", 1)).to_be_visible()
        assets: list[str] = []
        page.on("response", lambda resp: assets.append(resp.url) if resp.request.resource_type in ("script", "stylesheet") else None)
        page.goto(app_url + "/")
        html = page.content().lower()
        assert "content security policy" not in html.replace("-", " ")
        for a in assets:
            if same_origin(a, app_url):
                assert httpx.get(urlparse(a)._replace(query="").geturl() + ".map", timeout=HTTP_TIMEOUT).status_code == 404, f"source map shipped for {a}"


LAYOUT_PAGES = ["/", "/work", "/work/ledgerwick", "/worlds/ledgerwick", "/services", "/studio", "/pricing", "/faq", "/contact", f"/{PROBE_UNKNOWN}"]


def test_responsive_layout_targets(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        for w, h, cols in [(W_DESKTOP, H_DESKTOP, (3, 3, 4)), (W_TABLET, H_TABLET, (2, 2, 2)), (W_PHONE, H_PHONE, (1, 1, 1))]:
            page.set_viewport_size({"width": w, "height": h})
            for path in LAYOUT_PAGES:
                page.goto(app_url + path)
                layout(page)
                assert page.evaluate("() => document.documentElement.scrollWidth") == w, f"{path} scrolls sideways at {w}"
                if w == W_PHONE:
                    bad = page.evaluate(TARGETS_JS, MIN_TARGET)
                    assert bad == [], f"{path} controls under 44x44 at 375: {bad}"
            page.goto(app_url + "/work")
            assert columns(page.get_by_role("list", name="Projects", exact=True).get_by_role("listitem")) == cols[0]
            page.goto(app_url + "/pricing")
            assert columns(page.get_by_role("main").get_by_role("article")) == cols[1]
            page.goto(app_url + "/work/ledgerwick")
            assert columns(page.get_by_role("button", name=re.compile(r"^Open image \d of 4"))) == cols[2]
            if w >= W_TABLET:
                page.goto(app_url + "/")
                wait_attr(page, "mode", "3d")
                to_ring(page)
                buttons = rail(page).get_by_role("button")
                assert columns(buttons) == WORLD_COUNT, f"rail must fit one row at {w}"


def test_menu_dialog(browser: Browser, app_url: str) -> None:
    for w, h in [(W_PHONE, H_PHONE), (W_TABLET, H_TABLET)]:
        with opened(browser, app_url + "/studio", width=w, height=h) as page:
            menu_btn = btn(page, "Menu")
            expect(menu_btn).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("dialog", name="Menu", exact=True)).to_have_count(0)
            click(menu_btn)
            dialog = page.get_by_role("dialog", name="Menu", exact=True)
            expect(dialog).to_be_visible()
            assert dialog.evaluate(MODAL_JS)
            expect(menu_btn).to_have_attribute("aria-expanded", "true")
            nav = dialog.get_by_role("navigation", name="Menu sections", exact=True)
            assert texts(nav.get_by_role("link")) == MAIN_LINKS
            expect(lnk(nav, "Work")).to_be_focused()
            for key in ["Tab"] * 10 + ["Shift+Tab"] * 10:
                page.keyboard.press(key)
                assert dialog.evaluate("d => d.contains(document.activeElement)"), f"{key} escaped the menu"
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            expect(menu_btn).to_be_focused()
            click(menu_btn)
            settle_menu(page)
            click(btn(page.get_by_role("dialog", name="Menu", exact=True), "Close menu"))
            expect(page.get_by_role("dialog", name="Menu", exact=True)).to_have_count(0)
            expect(menu_btn).to_be_focused()
            click(menu_btn)
            settle_menu(page)
            box = page.get_by_role("dialog", name="Menu", exact=True).bounding_box()
            if box and box["y"] + box["height"] < h - 10:
                page.mouse.click(w / 2, h - 5)
                expect(page.get_by_role("dialog", name="Menu", exact=True)).to_have_count(0)
                expect(menu_btn).to_be_focused()
                click(menu_btn)
                settle_menu(page)
            click(lnk(page.get_by_role("dialog", name="Menu", exact=True), "Pricing"))
            expect(page).to_have_url(re.compile(r"/pricing$"))
            expect(page.get_by_role("dialog", name="Menu", exact=True)).to_have_count(0)


def test_deployment_health(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert httpx.head(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).status_code == 200
    expected = int(os.environ.get("APP_PUBLIC_PORT", "4173"))
    assert urlparse(app_url).port in (expected, None)
    for env in ["APP_MINIO_DOWN_URL", "APP_INTAKE_DOWN_URL"]:
        r = httpx.get(f"{os.environ[env]}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, env


def worlds_api(app_url: str) -> list[dict[str, Any]]:
    return httpx.get(f"{app_url}/api/worlds", timeout=HTTP_TIMEOUT).json()["items"]


def test_wf_immersive_entry_history(browser: Browser, app_url: str) -> None:
    api = worlds_api(app_url)
    assert api[0]["slug"] == "ledgerwick" and api[0]["index"] == 1 and api[0]["yaw"] == 0
    with opened(browser, app_url + "/", mode="3d") as page:
        tab_to(page, btn(page, "Enter the worlds"))
        page.keyboard.press("Enter")
        assert sattr(page, "camera") == "descending"
        expect(announcer(page)).to_have_text(world_line(1))
        advance(page, DESCENT_MS + FRAME_MS)
        assert sattr(page, "camera") == "ring"
        enter = btn(page, "Enter Ledgerwick Advisory")
        tab_to(page, enter, "Shift+Tab")
        assert focus_ring_ok(page)
        page.keyboard.press("Enter")
        for _ in range(2):
            expect(page).to_have_url(re.compile(r"/worlds/ledgerwick$"))
            expect(page).to_have_title("Ledgerwick Advisory | Vellum Orbit Studio")
            expect(heading(page, "Ledgerwick Advisory", 1)).to_be_focused()
            assert sattr(page, "camera") == "entering"
            advance(page, FLIGHT_MS + FRAME_MS)
            assert sattr(page, "camera") == "inside"
            page.go_back()
            expect(page).to_have_url(re.compile(r"/$"))
            expect(page).to_have_title("Vellum Orbit Studio | Eight brand worlds")
            expect(btn(page, "Enter Ledgerwick Advisory")).to_be_focused()
            assert sattr(page, "camera") == "leaving" and sattr(page, "active-world") == "ledgerwick"
            advance(page, FLIGHT_MS + FRAME_MS)
            assert sattr(page, "camera") == "ring"
            page.go_forward()


def test_wf_immersive_entry_phone(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, reduced_motion="reduce", mode="3d") as page:
        tap(btn(page, "Enter the worlds"))
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        assert sattr(page, "camera") == "ring"
        tap(btn(page, "Enter Ledgerwick Advisory"))
        expect(heading(page, "Ledgerwick Advisory", 1)).to_be_focused()
        assert sattr(page, "camera") == "inside"
        tap(btn(page, "Back to all worlds"))
        expect(btn(page, "Enter Ledgerwick Advisory")).to_be_focused()
        assert sattr(page, "camera") == "ring"
        page.goto(app_url + "/worlds/tiffin-theory")
        assert sattr(page, "camera") == "inside"
        tap(btn(page, "Back to all worlds"))
        expect(page).to_have_url(re.compile(r"/$"))
        expect(stage(page)).to_have_attribute("data-active-world", "tiffin-theory")
        g = geometry(page)
        assert_scroll_at(page, world_y(g, 7), "leaving a deep-linked world")
        assert worlds_api(app_url)[6]["yaw"] == 6 * WORLD_STEP_DEG


def test_wf_pointer_navigation_drag_rail_links(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        frames = scene_frames(stage(page).locator("canvas"), steps=3)
        assert any(f["draws"] for f in frames), "the stage must draw with WebGL"
        assert decode(frames[-1]["png"]).variance() > 0, "canvas capture is blank"
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0, "scene must animate over time"
        fetched = json.dumps([f["models"] for f in frames])
        assert all(f"/scenes/{s}/world.glb" in fetched for s in WORLD_IDS)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=4)
        page.mouse.up()
        expect(stage(page)).to_contain_text(numeral(2))
        assert_scroll_at(page, world_y(g, 2), "drag")
        rail_btn(page, "Monsoon Crate Coffee").focus()
        page.keyboard.press("ArrowRight")
        expect(stage(page)).to_contain_text("03 / 08")
        expect(heading(stage(page), "Basalt & Beam", 2)).to_be_visible()
        click(rail_btn(page, "Neem & Nectar"))
        expect(stage(page)).to_contain_text(numeral(5))
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "yaw") == "180.0"
        click(btn(page, "Enter Neem & Nectar"))
        advance(page, FLIGHT_MS + FRAME_MS)
        click(lnk(page, "Next world: Reelhouse Pictures"))
        assert sattr(page, "target-yaw") == "225.0"
        advance(page, FLIGHT_MS + FRAME_MS)
        click(btn(page, "Back to all worlds"))
        expect(btn(page, "Enter Reelhouse Pictures")).to_be_focused()
        expect(stage(page)).to_contain_text(numeral(6))
        assert_scroll_at(page, world_y(g, 6), "leaving Reelhouse")
        assert worlds_api(app_url)[5]["yaw"] == 225


def test_wf_pointer_navigation_release_over_header(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=6)
        page.mouse.move(x - PROBE_DRAG_LONG, HEADER_PX / 2, steps=4)
        page.mouse.up()
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == "monsoon-crate", "a drag released over the header must still select the next world"
        assert sattr(page, "target-yaw") == yaw_text(2) and yaw(page) == STEP_YAW, f"ring at {yaw(page)}, target {sattr(page, 'target-yaw')}"
        assert_scroll_at(page, world_y(g, 2), "a drag selection")
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=6)
        advance(page, FRAME_MS)
        assert yaw(page) == STEP_YAW and sattr(page, "active-world") == "monsoon-crate", "a pointer moved without a press must not turn the ring"


def test_wf_pointer_navigation_home_link_from_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/worlds/reelhouse", mode="3d") as page:
        expect(heading(page, "Reelhouse Pictures", 1)).to_be_visible()
        assert sattr(page, "camera") == "inside"
        click(lnk(page, "Vellum Orbit Studio home"))
        expect(page).to_have_url(re.compile(r"/$"))
        advance(page, FLIGHT_MS + TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == scroll_world(page), f"active {sattr(page, 'active-world')} but scroll {scroll_y(page)} names {scroll_world(page)}"
        page.goto(app_url + "/worlds/quillstack")
        expect(heading(page, "Quillstack", 1)).to_be_visible()
        click(lnk(page.get_by_role("banner"), "Studio"))
        expect(page).to_have_url(re.compile(r"/studio$"))
        click(lnk(page, "Vellum Orbit Studio home"))
        expect(page).to_have_url(re.compile(r"/$"))
        advance(page, FLIGHT_MS + TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == scroll_world(page), f"active {sattr(page, 'active-world')} but scroll {scroll_y(page)} names {scroll_world(page)}"


def test_wf_pointer_navigation_reduced_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        g = to_ring(page)
        from conftest import camera
        before = camera(page)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_SMALL, y, steps=4)
        advance(page, FRAME_MS)
        assert sattr(page, "yaw") == "0.0", "reduced motion: drag must not move the ring while down"
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=4)
        page.mouse.up()
        expect(stage(page)).to_have_attribute("data-active-world", "monsoon-crate")
        assert sattr(page, "yaw") == yaw_text(2)
        advance(page, FRAME_MS)
        assert camera(page) != before, "the drawn scene must respond to the drag"
        assert_scroll_at(page, world_y(g, 2), "reduced-motion drag")
        click(rail_btn(page, "Quillstack"))
        assert sattr(page, "yaw") == yaw_text(4)
        click(btn(page, "Enter Quillstack"))
        assert sattr(page, "camera") == "inside"


def test_wf_scroll_transitions_desktop(browser: Browser, app_url: str) -> None:
    names = [w["name"] for w in worlds_api(app_url)]
    assert names == [w["name"] for w in WORLDS]
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        announcer(page).evaluate(ANN_OBSERVE_JS)
        stage(page).evaluate(TARGET_OBSERVE_JS)
        order = list(range(2, 9)) + list(range(7, 0, -1))
        for k in list(range(2, 9)) + ["past"] + list(range(7, 0, -1)):
            if k == "past":
                scroll_to(page, g["brief"])
                expect(stage(page)).to_have_attribute("data-active-world", "static-bloom")
                continue
            scroll_to(page, world_y(g, k))
            expect(stage(page)).to_have_attribute("data-active-world", WORLD_IDS[k - 1])
            advance(page, TURN_MS + FRAME_MS)
            assert sattr(page, "yaw") == yaw_text(k)
        assert ann_seq(page) == [world_line(k) for k in order]
        assert target_seq(page) == [yaw_text(k) for k in order]


def test_wf_scroll_transitions_announcer_after_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        to_ring(page)
        click(rail_btn(page, "Basalt & Beam"))
        expect(announcer(page)).to_have_text(world_line(3))
        advance(page, TURN_MS + FRAME_MS)
        click(btn(page, "Enter Basalt & Beam"))
        expect(heading(page, "Basalt & Beam", 1)).to_be_focused()
        advance(page, DESCENT_MS + FLIGHT_MS + FRAME_MS)
        click(lnk(page.get_by_role("main"), "Next world: Quillstack"))
        expect(heading(page, "Quillstack", 1)).to_be_visible()
        advance(page, FLIGHT_MS + TURN_MS + FRAME_MS)
        click(btn(page, "Back to all worlds"))
        expect(page).to_have_url(re.compile(r"/$"))
        advance(page, FLIGHT_MS + FRAME_MS)
        expect(stage(page)).to_have_attribute("data-active-world", "quillstack")
        text = (announcer(page).text_content() or "").strip()
        assert text in ("", world_line(4)), f"announcer reads {text!r} while quillstack is active"
        announcer(page).evaluate(ANN_OBSERVE_JS)
        click(btn(page, "Previous world"))
        expect(stage(page)).to_have_attribute("data-active-world", "basalt-beam")
        expect(announcer(page)).to_have_text(world_line(3))
        assert ann_seq(page) == [world_line(3)], f"announcer sequence {ann_seq(page)}"


def test_wf_scroll_transitions_reload_at_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        scroll_to(page, world_y(g, 5))
        expect(stage(page)).to_have_attribute("data-active-world", "neem-nectar")
        page.reload()
        wait_attr(page, "mode", "3d")
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == scroll_world(page), f"after a reload {sattr(page, 'active-world')} is active but the scroll position {scroll_y(page)} names {scroll_world(page)}"
        expect(announcer(page)).to_have_text("")


def test_wf_scroll_transitions_tablet(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", width=W_TABLET, height=H_TABLET, reduced_motion="reduce", mode="3d") as page:
        g = to_ring(page)
        announcer(page).evaluate(ANN_OBSERVE_JS)
        stage(page).evaluate(TARGET_OBSERVE_JS)
        rail_btn(page, "Ledgerwick Advisory").focus()
        page.keyboard.press("End")
        assert_scroll_at(page, world_y(g, 8), "End")
        assert sattr(page, "yaw") == "315.0"
        page.keyboard.press("Home")
        assert_scroll_at(page, world_y(g, 1), "Home")
        assert sattr(page, "yaw") == "0.0"
        scroll_to(page, world_y(g, 4))
        assert sattr(page, "active-world") == "quillstack" and sattr(page, "yaw") == yaw_text(4)
        scroll_to(page, world_y(g, 2))
        assert sattr(page, "active-world") == "monsoon-crate" and sattr(page, "yaw") == yaw_text(2)
        assert ann_seq(page) == [world_line(8), world_line(1), world_line(4), world_line(2)]
        assert target_seq(page) == ["315.0", "0.0", yaw_text(4), yaw_text(2)]


def test_wf_keyboard_only_world_ring(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        tab_to(page, btn(page, "Enter the worlds"))
        assert focus_ring_ok(page)
        advance(page, FRAME_MS)
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(rail_btn(page, "Basalt & Beam")).to_be_focused()
        assert focus_ring_ok(page)
        enter = btn(page, "Enter Basalt & Beam")
        tab_to(page, enter, "Shift+Tab")
        assert focus_ring_ok(page)
        advance(page, FRAME_MS)
        page.keyboard.press("Enter")
        expect(heading(page, "Basalt & Beam", 1)).to_be_focused()
        tab_to(page, lnk(page, "Read the full case study"))
        assert focus_ring_ok(page)
        advance(page, FRAME_MS)
        page.keyboard.press("Escape")
        expect(enter).to_be_focused()
        assert sattr(page, "active-world") == "basalt-beam"
    assert worlds_api(app_url)[2]["name"] == "Basalt & Beam"


def test_wf_keyboard_only_menu_escape_on_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/worlds/neem-nectar", width=W_TABLET, height=H_TABLET, mode="3d") as page:
        expect(heading(page, "Neem & Nectar", 1)).to_be_visible()
        btn(page, "Menu").focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(lnk(menu, "Work")).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(btn(page, "Menu")).to_be_focused()
        expect(page).to_have_url(re.compile(r"/worlds/neem-nectar$"))
        assert sattr(page, "camera") == "inside", f"camera {sattr(page, 'camera')} after closing the menu"
        page.keyboard.press("Escape")
        expect(page).to_have_url(re.compile(r"/$"))
        expect(btn(page, "Enter Neem & Nectar")).to_be_focused()


def test_wf_keyboard_only_case_study_viewer(browser: Browser, app_url: str) -> None:
    caps = CAPTIONS["monsoon-crate"]
    with opened(browser, app_url + "/work", reduced_motion="reduce") as page:
        tile = lnk(page.get_by_role("list", name="Projects", exact=True), "Monsoon Crate Coffee")
        tab_to(page, tile)
        assert focus_ring_ok(page)
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/work/monsoon-crate$"))
        thumb = btn(page, f"Open image 1 of 4: {caps[0]}")
        tab_to(page, thumb)
        assert focus_ring_ok(page)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        expect(btn(dialog, "Close viewer")).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(dialog).to_contain_text("Image 2 of 4")
        expect(dialog).to_contain_text(caps[1])
        assert animations(dialog) == []
        page.keyboard.press("Escape")
        expect(thumb).to_be_focused()
        tab_to(page, lnk(page.get_by_role("main"), "All work"))
        page.keyboard.press("Enter")
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Monsoon Crate Coffee")).to_be_focused()
    api = httpx.get(f"{app_url}/api/projects/monsoon-crate", timeout=HTTP_TIMEOUT).json()
    assert api["gallery"][1]["caption"] == caps[1]


def test_wf_reduced_motion_rail_all_worlds(browser: Browser, app_url: str) -> None:
    api = worlds_api(app_url)
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        to_ring(page)
        for k, w in enumerate(WORLDS, 1):
            click(rail_btn(page, w["name"]))
            expect(stage(page)).to_have_attribute("data-active-world", w["slug"])
            assert sattr(page, "yaw") == yaw_text(k) == f"{api[k - 1]['yaw']:.1f}"
            if k > 1:
                expect(announcer(page)).to_have_text(world_line(k))
            click(btn(page, f"Enter {w['name']}"))
            expect(heading(page, w["name"], 1)).to_be_focused()
            assert sattr(page, "camera") == "inside"
            click(btn(page, "Back to all worlds"))
            expect(btn(page, f"Enter {w['name']}")).to_be_focused()
            assert sattr(page, "camera") == "ring"


def test_wf_reduced_motion_scroll_keys_buttons(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        announcer(page).evaluate(ANN_OBSERVE_JS)
        g = geometry(page)
        btn(page, "Enter the worlds").focus()
        page.keyboard.press("Enter")
        assert sattr(page, "camera") == "ring", "reduced motion: the descent completes in the step that starts it"
        expect(rail_btn(page, "Ledgerwick Advisory")).to_be_focused()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(rail_btn(page, "Basalt & Beam")).to_be_focused()
        assert sattr(page, "active-world") == "basalt-beam" and sattr(page, "yaw") == yaw_text(3) == sattr(page, "target-yaw")
        assert_scroll_at(page, world_y(g, 3), "rail keys with reduced motion")
        scroll_to(page, world_y(g, 6))
        assert sattr(page, "active-world") == "reelhouse" and sattr(page, "yaw") == yaw_text(6), "scroll sets the yaw at once"
        assert animations(stage(page)) == [], "reduced motion: nothing animates on the stage"
        click(btn(page, "Previous world"))
        assert sattr(page, "active-world") == "neem-nectar" and sattr(page, "yaw") == yaw_text(5)
        assert_scroll_at(page, world_y(g, 5), "Previous world with reduced motion")
        click(btn(page, "Next world"))
        assert sattr(page, "active-world") == "reelhouse" and sattr(page, "yaw") == yaw_text(6)
        expect(announcer(page)).to_have_text(world_line(6))
        expected = [world_line(k) for k in (1, 2, 3, 6, 5, 6)]
        assert ann_seq(page) == expected, f"announcer sequence {ann_seq(page)}, expected {expected}"


def test_wf_reduced_motion_leave_world_states(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", reduced_motion="reduce", mode="3d") as page:
        to_ring(page)
        click(rail_btn(page, "Basalt & Beam"))
        click(btn(page, "Enter Basalt & Beam"))
        expect(heading(page, "Basalt & Beam", 1)).to_be_focused()
        click(lnk(page.get_by_role("main"), "Next world: Quillstack"))
        expect(heading(page, "Quillstack", 1)).to_be_visible()
        click(btn(page, "Back to all worlds"))
        expect(page).to_have_url(re.compile(r"/$"))
        advance(page, FRAME_MS)
        expect(stage(page)).to_have_attribute("data-active-world", "quillstack")
        assert sattr(page, "camera") == "ring"
        text = (announcer(page).text_content() or "").strip()
        assert text in ("", world_line(4)), f"announcer reads {text!r} while quillstack is active"
        announcer(page).evaluate(ANN_OBSERVE_JS)
        click(btn(page, "Previous world"))
        expect(announcer(page)).to_have_text(world_line(3))
        assert ann_seq(page) == [world_line(3)], f"announcer sequence {ann_seq(page)}"
        page.goto(app_url + "/worlds/reelhouse")
        expect(heading(page, "Reelhouse Pictures", 1)).to_be_visible()
        click(lnk(page, "Vellum Orbit Studio home"))
        expect(page).to_have_url(re.compile(r"/$"))
        advance(page, FRAME_MS)
        assert sattr(page, "active-world") == scroll_world(page), f"active {sattr(page, 'active-world')} but scroll {scroll_y(page)} names {scroll_world(page)}"


def test_wf_reduced_motion_viewer_menu(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work/quillstack", width=W_PHONE, height=H_PHONE, reduced_motion="reduce") as page:
        btn(page, "Menu").focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(menu).to_be_visible()
        assert animations(menu) == []
        for _ in range(8):
            page.keyboard.press("Tab")
            assert menu.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(btn(page, "Menu")).to_be_focused()
        thumb = btn(page, f"Open image 3 of 4: {CAPTIONS['quillstack'][2]}")
        thumb.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        page.keyboard.press("ArrowLeft")
        expect(dialog).to_contain_text("Image 2 of 4")
        assert animations(dialog) == []
        page.keyboard.press("Escape")
        expect(thumb).to_be_focused()
    assert httpx.get(f"{app_url}/api/projects/quillstack", timeout=HTTP_TIMEOUT).json()["gallery"][2]["caption"] == CAPTIONS["quillstack"][2]


def send_and_confirm(page: Page, app_url: str, wiremock: Any, name: str, email: str) -> None:
    click(btn(page, "Send enquiry"))
    expect(heading(page, "Enquiry received", 2)).to_be_visible()
    recs = stored(app_url, email)
    assert len(recs) == 1 and recs[0]["intake_state"] == "sent"
    assert_sent(page, name, recs[0])
    assert len(intake_for(wiremock, email)) == 1


def test_wf_fallback_no_webgl(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("nowebgl")
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, no_webgl=True, mode="still") as page:
        expect(page.get_by_text("Your browser cannot show the 3D worlds, so here they are as a still gallery.", exact=True)).to_be_visible()
        tap(lnk(page, "Explore Quillstack"))
        expect(heading(page, "Quillstack", 1)).to_be_visible()
        expect(page.locator("canvas")).to_have_count(0)
        tap(lnk(page, "Read the full case study"))
        tap(btn(page, f"Open image 1 of 4: {CAPTIONS['quillstack'][0]}"))
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        expect(dialog.get_by_role("img", name=CAPTIONS["quillstack"][0], exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        page.goto(app_url + "/contact")
        to_review(page, name, email)
        send_and_confirm(page, app_url, wiremock, name, email)


def test_wf_fallback_minio_down(browser: Browser, app_url: str, wiremock: Any) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    name, email = visitor("minio")
    assert httpx.get(down + "/scenes/", timeout=HTTP_TIMEOUT).json() == {"error": "not_found"}
    assert httpx.get(down + "/scenes/reelhouse/world.glb", timeout=HTTP_TIMEOUT).status_code == 503
    with opened(browser, down + "/", mode="still") as page:
        notice = page.get_by_text("Some 3D scenes could not load, so the worlds are shown as a still gallery.", exact=True)
        expect(notice).to_be_visible()
        click(btn(page, "Try 3D again"))
        wait_attr(page, "mode", "still")
        expect(notice).to_be_visible()
        click(lnk(page, "Explore Reelhouse Pictures"))
        expect(heading(page, "Reelhouse Pictures", 1)).to_be_visible()
        page.goto(down + "/work/reelhouse")
        click(btn(page, f"Open image 2 of 4: {CAPTIONS['reelhouse'][1]}"))
        expect(page.get_by_role("dialog", name="Image viewer", exact=True).get_by_text("Image unavailable", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        page.goto(down + "/contact")
        to_review(page, name, email)
        click(btn(page, "Send enquiry"))
        expect(heading(page, "Enquiry received", 2)).to_be_visible()
        recs = stored(down, email)
        assert len(recs) == 1 and recs[0]["intake_state"] == "sent" and recs[0]["intake_reference"] == "IN-DEMO-0001"
        assert_sent(page, name, recs[0])
        assert len(intake_for(wiremock, email)) == 1


def test_wf_service_exploration_keyboard_enquire(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("svc")
    with opened(browser, app_url + "/services") as page:
        tablist = page.get_by_role("tablist", name="Services", exact=True)
        tablist.get_by_role("tab", name="Brand identity", exact=True).focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        expect(page).to_have_url(re.compile(r"/services/packaging$"))
        panel = page.get_by_role("tabpanel", name="Packaging", exact=True)
        tab_to(page, btn(panel, "1. Shelf study"))
        page.keyboard.press("Enter")
        expect(panel.get_by_text("We look at where your product sits and what surrounds it.", exact=True)).to_be_visible()
        tab_to(page, lnk(panel, "Enquire about Packaging"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/contact\?service=packaging$"))
        to_step_one(page, "Packaging")
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(page.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        fill(textbox(page, "Project description"), EX_DESCRIPTION)
        click(btn(page, "Next"))
        check(page.get_by_role("radio", name="Under ₹50,000", exact=True))
        click(btn(page, "Next"))
        assert review(page)["Service"] == "Packaging"
        send_and_confirm(page, app_url, wiremock, name, email)
    assert intake_for(wiremock, email)[0]["service"] == "packaging"


def test_wf_service_exploration_prices_link(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/services/framer-websites") as page:
        tablist = page.get_by_role("tablist", name="Services", exact=True)
        tab = tablist.get_by_role("tab", name="Framer websites", exact=True)
        expect(tab).to_have_attribute("aria-selected", "true")
        assert not focused(tab), "a direct load selects the tab without moving focus"
        tab.focus()
        page.keyboard.press("End")
        expect(tablist.get_by_role("tab", name="Social and content", exact=True)).to_be_focused()
        expect(page).to_have_url(re.compile(r"/services/social-content$"))
        page.keyboard.press("Home")
        expect(page).to_have_url(re.compile(r"/services/brand-identity$"))
        page.keyboard.press("ArrowRight")
        expect(tab).to_be_focused()
        expect(page).to_have_url(re.compile(r"/services/framer-websites$"))
        panel = page.get_by_role("tabpanel", name="Framer websites", exact=True)
        step_name, step_text = SERVICE_COPY["framer-websites"]["steps"][2]
        step = btn(panel, f"3. {step_name}")
        tab_to(page, step)
        page.keyboard.press("Space")
        expect(step).to_have_attribute("aria-expanded", "true")
        expect(panel.get_by_text(step_text, exact=True)).to_be_visible()
        page.keyboard.press("Space")
        expect(step).to_have_attribute("aria-expanded", "false")
        expect(panel.get_by_text(step_text, exact=True)).to_be_hidden()
        assert step_text not in panel.aria_snapshot(), "a closed step's paragraph must leave the accessibility tree"
        tab_to(page, lnk(panel, "See Framer websites prices"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/pricing\?category=framer-websites$"))
        expect(category_radio(page, "Framer websites (2)")).to_be_checked()
        expect(page.get_by_role("status", name="Price results", exact=True)).to_have_text("")
        assert price_names(page) == [r[2] for r in PRICES if r[1] == "framer-websites"]


def test_wf_service_exploration_unknown_service(browser: Browser, app_url: str) -> None:
    with opened(browser, f"{app_url}/services/{PROBE_UNKNOWN}") as page:
        expect(heading(page, "This service does not exist.", 1)).to_be_visible()
        click(lnk(page.get_by_role("main"), "All services"))
        first_tab = page.get_by_role("tab", name="Brand identity", exact=True)
        expect(first_tab).to_have_attribute("aria-selected", "true")
        first_tab.focus()
        page.keyboard.press("ArrowRight")
        expect(page).to_have_url(re.compile(r"/services/framer-websites$"))
        panel = page.get_by_role("tabpanel", name="Framer websites", exact=True)
        step_name, step_text = SERVICE_COPY["framer-websites"]["steps"][0]
        tab_to(page, btn(panel, f"1. {step_name}"))
        page.keyboard.press("Enter")
        expect(panel.get_by_text(step_text, exact=True)).to_be_visible()
        tab_to(page, lnk(panel, "Enquire about Framer websites"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/contact\?service=framer-websites$"))
    r = httpx.post(f"{app_url}/api/services", json={}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 405 and r.json() == {"error": "method_not_allowed"}
    assert [s["id"] for s in httpx.get(f"{app_url}/api/services", timeout=HTTP_TIMEOUT).json()["items"]] == SERVICE_ORDER


def test_wf_portfolio_filtering_show_more_return(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work") as page:
        click(svc_btn(page, "Brand identity"))
        expect(page.get_by_role("status", name="Results", exact=True)).to_have_text("7 projects match")
        click(btn(page, "Show more work"))
        shown = texts(tiles(page))
        assert len(shown) == len(set(shown)) == 7
        click(lnk(page.get_by_role("list", name="Projects", exact=True), "Relaywise"))
        page.go_back()
        assert url_query(page) == {"service": ["brand-identity"], "pages": ["2"]}
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Relaywise")).to_be_focused()
        assert texts(tiles(page)) == shown
    a = api_projects(app_url, service="brand-identity").json()
    b = api_projects(app_url, service="brand-identity", offset=a["next_offset"]).json()
    assert [project(i["slug"])["name"] for i in a["items"] + b["items"]] == shown


def test_wf_portfolio_filtering_keyboard_address(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work?service=packaging,shopify-stores&industry=food") as page:
        assert texts(tiles(page)) == ["Monsoon Crate Coffee"]
        tab_to(page, btn(page, "Clear filters"))
        page.keyboard.press("Enter")
        expect(svc_btn(page, "Brand identity")).to_be_focused()
        assert url_query(page) == {}
        tab_to(page, svc_btn(page, "Social and content"))
        page.keyboard.press("Space")
        expect(page.get_by_role("status", name="Results", exact=True)).to_have_text("4 projects match")
        tab_to(page, lnk(page.get_by_role("list", name="Projects", exact=True), "Saltpan Kitchen"))
        page.keyboard.press("Enter")
        tab_to(page, lnk(page.get_by_role("main"), "All work"))
        page.keyboard.press("Enter")
        assert url_query(page) == {"service": ["social-content"]}
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Saltpan Kitchen")).to_be_focused()
    assert api_projects(app_url, service="social-content").json()["total"] == 4


def test_wf_case_study_navigation_keyboard(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work?service=brand-identity&pages=2") as page:
        click(lnk(page.get_by_role("list", name="Projects", exact=True), "Ledgerwick Advisory"))
        click(lnk(page.get_by_role("main"), "Previous project: Relaywise"))
        expect(page).to_have_url(re.compile(r"/work/relaywise$"))
        click(lnk(page.get_by_role("main"), "Next project: Ledgerwick Advisory"))
        expect(heading(page, "Ledgerwick Advisory", 1)).to_be_visible()
        thumb = btn(page, f"Open image 4 of 4: {CAPTIONS['ledgerwick'][3]}")
        thumb.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("dialog", name="Image viewer", exact=True)).to_contain_text("Image 1 of 4")
        page.keyboard.press("Escape")
        expect(thumb).to_be_focused()
        click(lnk(page.get_by_role("main"), "All work"))
        assert url_query(page) == {"service": ["brand-identity"], "pages": ["2"]}
        names = texts(tiles(page))
        assert len(names) == len(set(names)) == 7
    assert httpx.get(f"{app_url}/api/projects/ledgerwick", timeout=HTTP_TIMEOUT).json()["previous"]["slug"] == "relaywise"


def test_wf_case_study_navigation_phone_swipe(browser: Browser, app_url: str) -> None:
    caps = CAPTIONS["static-bloom"]
    with opened(browser, app_url + "/work/static-bloom", width=W_PHONE, height=H_PHONE) as page:
        thumb = btn(page, f"Open image 1 of 4: {caps[0]}")
        tap(thumb)
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        box = dialog.get_by_role("img", name=caps[0], exact=True).bounding_box()
        assert box is not None
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        swipe(page, cx, cy, -PROBE_DRAG_LONG)
        expect(dialog).to_contain_text("Image 2 of 4")
        settle_viewer(page)
        swipe(page, cx, cy, PROBE_DRAG_LONG)
        expect(dialog).to_contain_text("Image 1 of 4")
        settle_viewer(page)
        swipe(page, cx, cy, PROBE_DRAG_LONG)
        expect(dialog).to_contain_text("Image 4 of 4")
        settle_viewer(page)
        img = dialog.get_by_role("img", name=caps[3], exact=True)
        assert urlparse(img.get_attribute("src") or "").path == "/media/static-bloom/4.svg"
        swipe(page, cx, cy, -PROBE_SHORT_SWIPE)
        expect(dialog).to_contain_text("Image 4 of 4")
        tap(btn(dialog, "Close viewer"))
        expect(thumb).to_be_focused()
    assert httpx.get(f"{app_url}/media/static-bloom/4.svg", timeout=HTTP_TIMEOUT).status_code == 200


def test_wf_case_study_navigation_unknown(browser: Browser, app_url: str) -> None:
    with opened(browser, f"{app_url}/work/{PROBE_UNKNOWN}") as page:
        expect(heading(page, "This project does not exist.", 1)).to_be_visible()
        click(lnk(page.get_by_role("main"), "All work"))
        expect(page).to_have_url(re.compile(r"/work$"))
        expect(tiles(page)).to_have_count(PAGE_SIZE)
        neem = project("neem-nectar")
        click(tiles(page).filter(has_text=neem["name"]).first)
        expect(heading(page, neem["name"], 1)).to_be_visible()
        expect(lnk(page.get_by_role("main"), "Next project: Reelhouse Pictures")).to_be_visible()
        click(lnk(page.get_by_role("main"), "All work"))
        expect(page).to_have_url(re.compile(r"/work$"))
        tile = page.get_by_role("list", name="Projects", exact=True).get_by_role("link", name=neem["name"], exact=True)
        expect(tile).to_be_focused()
        assert_clear(page, tile, "the returned-to tile")
    for path in ["/media/static-bloom/5.svg", f"/api/projects/{PROBE_UNKNOWN}"]:
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}


def test_wf_pricing_keyboard_reload_enquire(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("price")
    with opened(browser, app_url + "/pricing") as page:
        tab_to(page, category_radio(page, "All (14)"))
        page.keyboard.press("ArrowDown")
        expect(category_radio(page, "Brand identity (3)")).to_be_checked()
        tab_to(page, type_radio(page, "All types (3)"))
        page.keyboard.press("ArrowDown")
        expect(page.get_by_role("status", name="Price results", exact=True)).to_have_text("Showing 2 of 14 items")
        assert url_query(page) == {"category": ["brand-identity"], "type": ["fixed"]}
        page.reload()
        expect(category_radio(page, "Brand identity (2)")).to_be_checked()
        expect(type_radio(page, "Fixed price (2)")).to_be_checked()
        details = btn(page, "Details for Logo and wordmark")
        tab_to(page, details)
        page.keyboard.press("Enter")
        tab_to(page, lnk(page, "Enquire about Logo and wordmark"))
        page.keyboard.press("Enter")
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        expect(page.get_by_role("radio", name="Brand identity", exact=True)).to_be_checked()
        expect_attached(page, "Logo and wordmark")
        click(btn(page, "Back"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        expect(page.get_by_role("radio", name="Brand identity", exact=True)).to_be_checked()
        expect_attached(page, "Logo and wordmark")
        fill(textbox(page, "Project description"), EX_DESCRIPTION)
        click(btn(page, "Next"))
        check(page.get_by_role("radio", name="Under ₹50,000", exact=True))
        click(btn(page, "Next"))
        send_and_confirm(page, app_url, wiremock, name, email)
    assert intake_for(wiremock, email)[0]["item"] == "logo-wordmark"


def test_wf_pricing_details_keep_state(browser: Browser, app_url: str) -> None:
    custom = next(r for r in PRICES if r[0] == "campaign-content")
    with opened(browser, app_url + "/pricing?category=social-content") as page:
        status = page.get_by_role("status", name="Price results", exact=True)
        expect(category_radio(page, "Social and content (3)")).to_be_checked()
        expect(status).to_have_text("")
        art = price_article(page, custom[2])
        details = btn(art, f"Details for {custom[2]}")
        tab_to(page, details)
        page.keyboard.press("Space")
        expect(details).to_have_attribute("aria-expanded", "true")
        for inc in custom[7]:
            expect(art.get_by_text(inc, exact=True)).to_be_visible()
        expect(art.get_by_text(PAYMENT_LINE["custom"], exact=True)).to_be_visible()
        tab_to(page, lnk(art, f"Enquire about {custom[2]}"))
        tab_to(page, type_radio(page, "All types (3)"), key="Shift+Tab")
        page.keyboard.press("ArrowDown")
        expect(type_radio(page, "Fixed price (2)")).to_be_checked()
        expect(status).to_have_text("Showing 2 of 14 items")
        expect(price_article(page, custom[2])).to_have_count(0)
        page.keyboard.press("ArrowDown")
        expect(type_radio(page, "Custom quote (1)")).to_be_checked()
        expect(status).to_have_text("Showing 1 of 14 items")
        assert url_query(page) == {"category": ["social-content"], "type": ["custom"]}
        expect(details).to_have_attribute("aria-expanded", "true")
        tab_to(page, details)
        page.keyboard.press("Enter")
        expect(details).to_have_attribute("aria-expanded", "false")
        expect(lnk(art, f"Enquire about {custom[2]}")).to_have_count(0)
        page.keyboard.press("Tab")
        assert not art.evaluate("a => a.contains(document.activeElement) && document.activeElement.tagName === 'A'"), \
            "a closed details panel's link must not be reachable by Tab"


def test_wf_pricing_phone_empty_state(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/pricing", width=W_PHONE, height=H_PHONE) as page:
        tap(category_radio(page, "Framer websites (2)"))
        tap(type_radio(page, "Custom quote (0)"))
        expect(page.get_by_role("status", name="Price results", exact=True)).to_have_text("No items match these filters.")
        tap(btn(page, "Show all items"))
        expect(page.get_by_role("status", name="Price results", exact=True)).to_have_text("Showing 14 of 14 items")
        assert len(price_names(page)) == PRICE_COUNT and url_query(page) == {}
    assert len(httpx.get(f"{app_url}/api/prices", timeout=HTTP_TIMEOUT).json()["items"]) == PRICE_COUNT


MULTILINE = "A range of six tea tins.\nFor a new Kochi tea label."


def test_wf_enquiry_steps_keyboard_reload_review(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("kbd")
    with opened(browser, app_url + "/contact") as page:
        tab_to(page, textbox(page, "Name"))
        page.keyboard.type(name)
        page.keyboard.press("Tab")
        page.keyboard.type(PROBE_BAD_EMAIL)
        page.keyboard.press("Tab")
        page.keyboard.type(EX_BUSINESS)
        tab_to(page, btn(page, "Next"))
        page.keyboard.press("Enter")
        expect(textbox(page, "Email")).to_be_focused()
        page.keyboard.press("Control+a")
        page.keyboard.type(email)
        tab_to(page, btn(page, "Next"))
        page.keyboard.press("Enter")
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        check(page.get_by_role("radio", name="Framer websites", exact=True))
        textbox(page, "Project description").focus()
        first, second = MULTILINE.split("\n")
        page.keyboard.type(first)
        page.keyboard.press("Enter")
        page.keyboard.type(second)
        page.reload()
        expect(textbox(page, "Project description")).to_have_value(MULTILINE)
        tab_to(page, btn(page, "Next"))
        page.keyboard.press("Enter")
        check(page.get_by_role("radio", name="₹1,50,000 to ₹5,00,000", exact=True))
        tab_to(page, btn(page, "Next"))
        page.keyboard.press("Enter")
        assert review(page) == {"Name": name, "Email": email, "Business name": EX_BUSINESS, "Service": "Framer websites", "Project description": MULTILINE, "Approximate budget": "₹1,50,000 to ₹5,00,000"}
        send_and_confirm(page, app_url, wiremock, name, email)
    rec = stored(app_url, email)[0]
    assert rec["description"] == MULTILINE and rec["service"] == "framer-websites" and rec["budget"] == "150k-500k" and rec["item"] is None
    assert intake_for(wiremock, email)[0]["description"] == MULTILINE


def test_wf_enquiry_steps_reload_keeps_answers(browser: Browser, app_url: str) -> None:
    name, email = visitor("reload")
    with opened(browser, app_url + "/contact") as page:
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_visible()
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        service = page.get_by_role("radiogroup", name="Service", exact=True)
        check(service.get_by_role("radio", name="Packaging", exact=True))
        page.reload()
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        expect(service.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
        check(service.get_by_role("radio", name="Brand identity", exact=True))
        page.reload()
        expect(service.get_by_role("radio", name="Brand identity", exact=True)).to_be_checked()
        click(btn(page, "Back"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        expect(textbox(page, "Name")).to_have_value(name)
        expect(textbox(page, "Email")).to_have_value(email)
        expect(textbox(page, "Business name")).to_have_value(EX_BUSINESS)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        expect(service.get_by_role("radio", name="Brand identity", exact=True)).to_be_checked()
        fill(textbox(page, "Project description"), EX_DESCRIPTION)
        click(btn(page, "Next"))
        check(page.get_by_role("radio", name="Not sure yet", exact=True))
        click(btn(page, "Next"))
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_focused()
        expected = {"Name": name, "Email": email, "Business name": EX_BUSINESS, "Service": "Brand identity", "Project description": EX_DESCRIPTION, "Approximate budget": "Not sure yet"}
        assert review(page) == expected
        page.reload()
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_visible()
        expect(step_item(page, "Review")).to_have_attribute("aria-current", "step")
        assert review(page) == expected


def test_wf_enquiry_steps_radio_errors(browser: Browser, app_url: str) -> None:
    name, email = visitor("radios")
    with opened(browser, app_url + "/contact") as page:
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        desc = textbox(page, "Project description")
        fill(desc, EX_DESCRIPTION[:DESC_MIN - 1])
        click(btn(page, "Next"))
        group = page.get_by_role("radiogroup", name="Service", exact=True)
        expect(group).to_have_attribute("aria-invalid", "true")
        assert "Choose a service." in group.evaluate(DESCRIBED_JS)
        expect(desc).to_have_attribute("aria-invalid", "true")
        assert "Describe your project in at least 30 characters." in desc.evaluate(DESCRIBED_JS)
        first = group.get_by_role("radio", name=SERVICES[0][1], exact=True)
        expect(first).to_be_focused()
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        page.keyboard.press("Space")
        expect(first).to_be_checked()
        expect(page.get_by_text("Choose a service.", exact=True)).to_have_count(0)
        page.keyboard.press("ArrowDown")
        expect(group.get_by_role("radio", name=SERVICES[1][1], exact=True)).to_be_checked()
        fill(desc, EX_DESCRIPTION)
        expect(page.get_by_text("Describe your project in at least 30 characters.", exact=True)).to_have_count(0)
        click(btn(page, "Next"))
        expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
        click(btn(page, "Next"))
        budget = page.get_by_role("radiogroup", name="Approximate budget", exact=True)
        expect(budget).to_have_attribute("aria-invalid", "true")
        assert "Choose an approximate budget." in budget.evaluate(DESCRIBED_JS)
        expect(budget.get_by_role("radio", name=BUDGETS[0][1], exact=True)).to_be_focused()
        click(btn(page, "Back"))
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
        expect(group.get_by_role("radio", name=SERVICES[1][1], exact=True)).to_be_checked()
        expect(desc).to_have_value(EX_DESCRIPTION)
        click(btn(page, "Back"))
        expect(textbox(page, "Name")).to_have_value(name)
        expect(textbox(page, "Email")).to_have_value(email)


def test_wf_enquiry_steps_length_limits(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("len")
    with opened(browser, app_url + "/contact") as page:
        fill(textbox(page, "Name"), name)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        check(page.get_by_role("radio", name="Packaging", exact=True))
        fill(textbox(page, "Project description"), "🌿" * (DESC_MAX + 1))
        expect(page.get_by_text("1,201 / 1,200 characters", exact=True)).to_be_visible()
        click(btn(page, "Next"))
        expect(page.get_by_text("Keep your description to 1,200 characters or fewer.", exact=True)).to_be_visible()
        expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_visible()
        fill(textbox(page, "Project description"), "🌿" * DESC_MAX)
        expect(page.get_by_text("1,200 / 1,200 characters", exact=True)).to_be_visible()
        click(btn(page, "Next"))
        check(page.get_by_role("radio", name="Not sure yet", exact=True))
        click(btn(page, "Next"))
        send_and_confirm(page, app_url, wiremock, name, email)
    assert stored(app_url, email)[0]["description"] == "🌿" * DESC_MAX


def test_wf_enquiry_sending_intake_failure_retry(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("retryui")
    wiremock.stub("POST", INTAKE_PATH, status=503, json={"error": PROBE_UNKNOWN})
    with opened(browser, app_url + "/contact") as page:
        to_review(page, name, email)
        answers = review(page)
        with held(page, "**/api/enquiries") as hold:
            click(btn(page, "Send enquiry"))
            expect(btn(page, "Sending…")).to_be_disabled()
            expect(page.get_by_role("status", name="Enquiry status", exact=True)).to_have_text("Sending your enquiry…")
            hold.release()
        expect(page.get_by_role("alert").filter(has_text=INTAKE_FAIL_ALERT)).to_be_visible()
        expect(btn(page, "Try again")).to_be_focused()
        assert review(page) == answers
        recs = stored(app_url, email)
        assert len(recs) == 1 and recs[0]["intake_state"] == "failed"
        page.reload()
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_visible()
        assert review(page) == answers, f"a reload after the intake failure changed the review to {review(page)}"
        baseline_intake(wiremock)
        retry = btn(page, "Try again")
        click(retry if retry.count() else btn(page, "Send enquiry"))
        expect(heading(page, "Enquiry received", 2)).to_be_focused()
        recs = stored(app_url, email)
        assert len(recs) == 1 and recs[0]["intake_state"] == "sent"
        assert_sent(page, name, recs[0])
        calls = intake_for(wiremock, email)
        assert len(calls) == 2 and {c["reference"] for c in calls} == {recs[0]["reference"]}
        expect(page.get_by_role("alert").filter(has_text=INTAKE_FAIL_ALERT)).to_have_count(0)
        click(btn(page, "Start another enquiry"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        expect(textbox(page, "Name")).to_have_value("")


def test_wf_enquiry_sending_held_double_press(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("double")
    posts: list[str] = []
    with opened(browser, app_url + "/contact") as page:
        to_review(page, name, email)
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and urlparse(r.url).path == "/api/enquiries" else None)
        with held(page, "**/api/enquiries") as hold:
            click(btn(page, "Send enquiry"))
            sending = btn(page, "Sending…")
            expect(sending).to_be_disabled()
            expect(page.get_by_role("status", name="Enquiry status", exact=True)).to_have_text("Sending your enquiry…")
            box = sending.bounding_box()
            assert box is not None
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            hold.release()
        expect(heading(page, "Enquiry received", 2)).to_be_focused()
        assert len(posts) == 1, f"one press of Send enquiry posts once, got {len(posts)}"
        recs = stored(app_url, email)
        assert len(recs) == 1 and recs[0]["intake_state"] == "sent"
        assert_sent(page, name, recs[0])
        calls = intake_for(wiremock, email)
        assert len(calls) == 1 and calls[0]["reference"] == recs[0]["reference"]
        click(btn(page, "Start another enquiry"))
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_focused()
        page.reload()
        expect(heading(page, "Step 1 of 4: About you", 2)).to_be_visible()
        expect(textbox(page, "Name")).to_have_value("")


def test_wf_enquiry_sending_intake_unreachable(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_INTAKE_DOWN_URL"]
    name, email = visitor("intakedown")
    is_post = lambda r: urlparse(r.url).path == "/api/enquiries" and r.request.method == "POST"
    with opened(browser, down + "/contact") as page:
        to_review(page, name, email, description=MULTILINE)
        answers = review(page)
        btn(page, "Send enquiry").focus()
        with page.expect_response(is_post) as first:
            page.keyboard.press("Enter")
        assert first.value.status == 502
        alert = page.get_by_role("alert").filter(has_text=INTAKE_FAIL_ALERT)
        expect(alert).to_be_visible()
        expect(btn(page, "Try again")).to_be_focused()
        assert review(page) == answers
        recs = stored(down, email)
        assert len(recs) == 1 and recs[0]["intake_state"] == "failed"
        with page.expect_response(is_post) as second:
            page.keyboard.press("Enter")
        assert second.value.status == 502
        expect(alert).to_be_visible()
        expect(btn(page, "Try again")).to_be_focused()
        again = stored(down, email)
        assert len(again) == 1 and again[0]["reference"] == recs[0]["reference"]
        assert again[0]["submission_id"] == recs[0]["submission_id"] and again[0]["intake_state"] == "failed"
        assert again[0]["description"] == MULTILINE and again[0]["name"] == name and again[0]["email"] == email


def test_wf_enquiry_sending_limit_simultaneous(browser: Browser, app_url: str, wiremock: Any) -> None:
    BURSTS = 3
    for burst in range(BURSTS):
        name, email = visitor(f"burst{burst}")
        bodies = [enquiry(email) for _ in range(2 * ENQUIRY_LIMIT)]
        with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
            replies = list(pool.map(lambda body: post(app_url, body), bodies))
        codes = sorted(r.status_code for r in replies)
        assert codes == [201] * ENQUIRY_LIMIT + [429] * ENQUIRY_LIMIT, f"burst {burst + 1}: simultaneous posts answered {codes}"
        for r in replies:
            if r.status_code == 429:
                assert r.headers.get("retry-after") == str(r.json()["retry_after_seconds"])
        assert len(stored(app_url, email)) == ENQUIRY_LIMIT and len(intake_for(wiremock, email)) == ENQUIRY_LIMIT
    with opened(browser, app_url + "/contact") as page:
        to_review(page, name, email)
        click(btn(page, "Send enquiry"))
        expect(page.get_by_role("alert").filter(has_text="You have sent 3 enquiries from this email address in the last 10 minutes.")).to_be_visible()
    assert len(stored(app_url, email)) == ENQUIRY_LIMIT


def test_enquiry_email_untrimmed(app_url: str, wiremock: Any) -> None:
    for pad in ("lead", "trail"):
        email = email_of(f"pad{pad}")
        sent = f" {email}" if pad == "lead" else f"{email} "
        r = post(app_url, enquiry(sent))
        assert r.status_code == 422 and r.json() == {"errors": {"email": "Enter an email address like name@example.com."}}, f"{sent!r}: {r.status_code} {r.text[:120]}"
        assert stored(app_url, sent) == [] and stored(app_url, email) == []
        assert intake_for(wiremock, email) == []


def test_wf_enquiry_sending_limit(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("limitui")
    for _ in range(ENQUIRY_LIMIT):
        assert post(app_url, enquiry(email)).status_code == 201
    with opened(browser, app_url + "/contact") as page:
        to_review(page, name, email)
        click(btn(page, "Send enquiry"))
        alert = page.get_by_role("alert").filter(has_text="You have sent 3 enquiries from this email address in the last 10 minutes.")
        expect(alert).to_be_visible()
        text = alert.text_content() or ""
        m = re.search(r"Try again in (\d+) (minute|minutes)\.$", text.strip())
        assert m and (m.group(2) == "minute") == (m.group(1) == "1"), f"wait sentence wrong: {text!r}"
        assert focused(alert) or alert.evaluate("a => a.contains(document.activeElement)")
        expect(btn(page, "Send enquiry")).to_be_enabled()
    assert len(stored(app_url, email)) == ENQUIRY_LIMIT and len(intake_for(wiremock, email)) == ENQUIRY_LIMIT


def test_wf_enquiry_sending_length_refusal(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("lenref")
    r = post(app_url, enquiry(email, name="n" * (NAME_MAX + 1)))
    assert r.status_code == 422 and stored(app_url, email) == []
    with opened(browser, app_url + "/contact") as page:
        fill(textbox(page, "Name"), "n" * (NAME_MAX + 1))
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Business name"), EX_BUSINESS)
        click(btn(page, "Next"))
        expect(page.get_by_text("Keep your name to 80 characters or fewer.", exact=True)).to_be_visible()
        click(btn(page, "Back")) if btn(page, "Back").count() else None
        page.reload()
        fill(textbox(page, "Name"), "")
        to_review(page, name, email)
        send_and_confirm(page, app_url, wiremock, name, email)


def test_wf_mobile_accessibility_phone(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, mode="3d") as page:
        axe(page)
        layout(page)
        btn(page, "Menu").focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(lnk(menu, "Work")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        advance(page, FRAME_MS)
        assert menu.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(btn(page, "Menu")).to_be_focused()
        g = to_ring(page)
        x, y = drag_point(page)
        swipe(page, x, y, -PROBE_DRAG_LONG)
        expect(stage(page)).to_have_attribute("data-active-world", "monsoon-crate")
        x, y = drag_point(page)
        touch_scroll(page, x, y, g["vh"] * 2)
        sy = scroll_y(page)
        k = max(0, min(7, math.floor((sy - g["top"]) / g["vh"] + 0.5))) + 1
        assert sy > world_y(g, 2) + g["vh"] / 2, f"touch scroll did not move the page beyond world 2 (scroll {sy})"
        assert k >= 3, f"active world index did not increase after the touch scroll (k={k})"
        expect(stage(page)).to_have_attribute("data-active-world", WORLD_IDS[k - 1])
        rail_btn(page, WORLDS[k - 1]["name"]).focus()
        page.keyboard.press("End")
        box = rail_btn(page, "Static Bloom").bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= W_PHONE + SCROLL_TOL_PX, "rail must keep the active button in view"
        layout(page)
        for path in ["/work", "/contact"]:
            page.goto(app_url + path)
            axe(page)
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}


def test_wf_mobile_accessibility_rail_after_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", width=W_PHONE, height=H_PHONE, mode="3d") as page:
        to_ring(page)
        rail_btn(page, "Ledgerwick Advisory").focus()
        page.keyboard.press("End")
        expect(stage(page)).to_have_attribute("data-active-world", "static-bloom")
        advance(page, TURN_MS + FRAME_MS)

        def in_view() -> bool:
            box = rail_btn(page, "Static Bloom").bounding_box()
            return box is not None and box["x"] >= -SCROLL_TOL_PX and box["x"] + box["width"] <= W_PHONE + SCROLL_TOL_PX

        assert in_view(), f"after End the active rail button sits at {rail_btn(page, 'Static Bloom').bounding_box()}"
        tap(btn(page, "Enter Static Bloom"))
        expect(heading(page, "Static Bloom", 1)).to_be_focused()
        advance(page, DESCENT_MS + FLIGHT_MS + FRAME_MS)
        tap(btn(page, "Back to all worlds"))
        expect(btn(page, "Enter Static Bloom")).to_be_focused()
        advance(page, FLIGHT_MS + FRAME_MS)
        assert in_view(), f"after leaving the world the active rail button sits at {rail_btn(page, 'Static Bloom').bounding_box()}"


def test_wf_mobile_accessibility_reduced_motion(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/faq", width=W_PHONE, height=H_PHONE, reduced_motion="reduce") as page:
        tap(btn(page, "Menu"))
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(menu).to_be_visible()
        assert animations(menu) == []
        settle_menu(page, FRAME_MS)
        tap(btn(menu, "Close menu"))
        expect(page.get_by_role("contentinfo").get_by_text(FOOTER_NOTICE, exact=True)).to_be_visible()
        axe(page)
        expect(page.get_by_role("main").get_by_role("heading", level=2)).to_have_count(len(QUESTIONS))
        page.goto(app_url + "/pricing")
        axe(page)
    assert len(httpx.get(f"{app_url}/api/questions", timeout=HTTP_TIMEOUT).json()["items"]) == len(QUESTIONS)


def test_wf_mobile_accessibility_not_found(browser: Browser, app_url: str) -> None:
    with opened(browser, f"{app_url}/{PROBE_UNKNOWN}", width=W_PHONE, height=H_PHONE) as page:
        expect(heading(page, "This page does not exist.", 1)).to_be_visible()
        axe(page)
        tap(btn(page, "Menu"))
        settle_menu(page)
        tap(lnk(page.get_by_role("dialog", name="Menu", exact=True), "Studio"))
        expect(page).to_have_url(re.compile(r"/studio$"))
    assert httpx.get(f"{app_url}/.env", timeout=HTTP_TIMEOUT).status_code == 404


MID_TURN_MS = TURN_MS / 2


def test_wf_immersive_entry_enter_mid_turn(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        to_ring(page)
        click(rail_btn(page, "Basalt & Beam"))
        advance(page, MID_TURN_MS)
        seq = [yaw(page)]
        click(btn(page, "Enter Basalt & Beam"))
        expect(heading(page, "Basalt & Beam", 1)).to_be_focused()
        seq.append(yaw(page))
        for _ in range((TURN_MS + 3 * FRAME_MS) // FRAME_MS):
            advance(page, FRAME_MS)
            seq.append(yaw(page))
        assert all(b >= a for a, b in zip(seq, seq[1:])), f"the drawn yaw went backwards after Enter: {seq}"
        assert seq[-1] == float(yaw_text(3)), f"the ring never settled on Basalt & Beam: {seq}"


FOCUS_RING_JS = """() => {
  const e = document.activeElement, s = getComputedStyle(e);
  const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  let bg = 'rgb(255, 255, 255)';
  for (let n = e.parentElement; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
  }
  const lum = (p) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                       return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const a = lum(rgb(s.outlineColor)), b = lum(rgb(bg));
  return {style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0, colour: s.outlineColor, behind: bg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)};
}"""
LIGHT_GROUND_TARGETS = [
    ("/worlds/neem-nectar", "link", "Read the full case study"),
    ("/worlds/tiffin-theory", "button", "Back to all worlds"),
    ("/work/saltpan-kitchen", "button", "Open image 1 of 4"),
    ("/work/courtyard-homes", "link", "All work"),
]


def test_wf_keyboard_only_focus_ring_light_grounds(browser: Browser, app_url: str) -> None:
    rings = {}
    for path, role, name in LIGHT_GROUND_TARGETS:
        with opened(browser, app_url + path) as page:
            target = page.get_by_role("main").get_by_role(role, name=name, exact=role == "link").first
            tab_to(page, target)
            rings[path] = page.evaluate(FOCUS_RING_JS)
    bad = {p: r for p, r in rings.items() if r["style"] == "none" or r["width"] < 2 or r["ratio"] < 3}
    assert bad == {}, f"focus rings missing or under 3:1: {bad}"


UNKNOWN_FILE_METHODS = [
    ("DELETE", "/scenes/"),
    ("PUT", "/scenes/ledgerwick/"),
    ("POST", "/media/ledgerwick/"),
]


def test_wf_fallback_unknown_file_methods(app_url: str) -> None:
    for method, path in UNKNOWN_FILE_METHODS:
        r = httpx.request(method, app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, f"{method} {path}: {r.status_code} {r.text[:120]}"
    r = httpx.post(app_url + "/media/ledgerwick/1.svg", timeout=HTTP_TIMEOUT)
    assert r.status_code == 405 and r.json() == {"error": "method_not_allowed"} and "GET" in r.headers.get("allow", "")


def chunked(data: bytes, size: int = 4096) -> Iterator[bytes]:
    for i in range(0, len(data), size):
        yield data[i:i + size]


def test_wf_enquiry_sending_chunked_oversize(app_url: str) -> None:
    url = f"{app_url}/api/enquiries"
    big = email_of("chunkbig")
    raw = json.dumps(enquiry(big)).encode()
    body = raw + b" " * (BODY_MAX + 1 - len(raw))
    r, errors = None, []
    for _ in range(2):
        try:
            r = httpx.post(url, content=chunked(body, len(body)), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
            break
        except httpx.HTTPError as exc:
            errors.append(repr(exc))
    if r is None:
        pytest.fail(f"a chunked {len(body)}-byte post got no answer in two tries: {errors}")
    assert r.status_code == 413 and r.json() == {"error": "too_large"}, f"chunked {len(body)} bytes: {r.status_code} {r.text[:200]}"
    assert stored(app_url, big) == []
    small = email_of("chunksmall")
    r = httpx.post(url, content=chunked(json.dumps(enquiry(small)).encode(), 64), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"a chunked post under the limit: {r.status_code} {r.text[:200]}"
    assert len(stored(app_url, small)) == 1


def test_wf_portfolio_filtering_all_work_exact_address(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/work?industry=food&service=brand-identity") as page:
        expect(svc_btn(page, "Brand identity")).to_have_attribute("aria-pressed", "true")
        came_from = live_url(page)
        click(lnk(page.get_by_role("list", name="Projects", exact=True), "Monsoon Crate Coffee"))
        expect(heading(page, "Monsoon Crate Coffee", 1)).to_be_visible()
        page.go_back()
        tile = lnk(page.get_by_role("list", name="Projects", exact=True), "Monsoon Crate Coffee")
        expect(tile).to_be_focused()
        assert live_url(page) == came_from, f"Back led to {live_url(page)}, the visitor came from {came_from}"
        click(tile)
        expect(heading(page, "Monsoon Crate Coffee", 1)).to_be_visible()
        click(lnk(page.get_by_role("main"), "All work"))
        expect(lnk(page.get_by_role("list", name="Projects", exact=True), "Monsoon Crate Coffee")).to_be_focused()
        assert live_url(page) == came_from, f"All work led to {live_url(page)}, the visitor came from {came_from}"

def band_below(page: Page, slug: str, height: int) -> None:
    band = stage(page).bounding_box()
    article = page.locator(f'[data-world="{slug}"]').bounding_box()
    assert band is not None and article is not None
    assert abs(band["height"] - STAGE_BAND * height) <= 2 * SCROLL_TOL_PX, f"the band is {band['height']} px tall"
    assert band["y"] <= HEADER_PX + SCROLL_TOL_PX, f"the band starts {band['y']} px down the page, not at its top"
    assert article["y"] >= band["y"] + band["height"] - SCROLL_TOL_PX, \
        f"the article starts at {article['y']}, over the band that runs to {band['y'] + band['height']}"


def test_wf_immersive_entry_world_band_top(browser: Browser, app_url: str) -> None:
    for w, h in [(W_DESKTOP, H_DESKTOP), (W_TABLET, H_TABLET), (W_PHONE, H_PHONE)]:
        with opened(browser, f"{app_url}/worlds/basalt-beam", width=w, height=h, mode="3d") as page:
            band_below(page, "basalt-beam", h)
    with opened(browser, app_url + "/", mode="3d") as page:
        to_ring(page)
        click(btn(page, "Enter Ledgerwick Advisory"))
        expect(heading(page, "Ledgerwick Advisory", 1)).to_be_focused()
        advance(page, FLIGHT_MS + FRAME_MS)
        assert sattr(page, "camera") == "inside"
        band_below(page, "ledgerwick", H_DESKTOP)


PANEL_BOXES_JS = "d => [...d.querySelectorAll('button, a')].filter((c) => c.getClientRects().length).map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })"


def off_panel(menu: Locator, x: float, y: float) -> bool:
    return not any(left <= x <= right and top <= y <= bottom for left, top, right, bottom in menu.evaluate(PANEL_BOXES_JS))


def test_wf_mobile_accessibility_menu_tap_header(browser: Browser, app_url: str) -> None:
    for path in ["/studio", "/"]:
        with opened(browser, app_url + path, width=W_PHONE, height=H_PHONE) as page:
            menu_btn = btn(page, "Menu")
            box = menu_btn.bounding_box()
            assert box is not None
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            tap(menu_btn)
            settle_menu(page)
            menu = page.get_by_role("dialog", name="Menu", exact=True)
            expect(lnk(menu, "Work")).to_be_focused()
            assert off_panel(menu, x, y), f"{path}: the tap point lies on a control of the open panel"
            page.touchscreen.tap(x, y)
            advance(page, MENU_MS + FRAME_MS)
            expect(menu).to_have_count(0)
            expect(menu_btn).to_be_focused()
            expect(menu_btn).to_have_attribute("aria-expanded", "false")


def test_wf_mobile_accessibility_menu_escape_world(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/worlds/neem-nectar", width=W_PHONE, height=H_PHONE, mode="3d") as page:
        menu_btn = btn(page, "Menu")
        tap(menu_btn)
        settle_menu(page)
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(lnk(menu, "Work")).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_have_count(0)
        expect(menu_btn).to_be_focused()
        assert url_path(page) == "/worlds/neem-nectar"
        assert sattr(page, "camera") == "inside"


def test_wf_pointer_navigation_back_to_press_point(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/", mode="3d") as page:
        g = to_ring(page)
        click(rail_btn(page, "Basalt & Beam"))
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "yaw") == yaw_text(3)
        x, y = drag_point(page)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - PROBE_DRAG_LONG, y, steps=4)
        advance(page, FRAME_MS)
        wait_for(lambda: abs(yaw(page) - (2 * STEP_YAW + PROBE_DRAG_LONG * DRAG_FACTOR)) <= 0.05, f"the ring must follow the pointer (yaw {yaw(page)})")
        page.mouse.move(x, y)
        advance(page, FRAME_MS)
        wait_for(lambda: sattr(page, "yaw") == yaw_text(3), f"pointer back on its press point in one move: drawn yaw {sattr(page, 'yaw')}, the yaw at press is {yaw_text(3)}")
        page.mouse.move(x + PROBE_DRAG_SMALL, y, steps=4)
        advance(page, FRAME_MS)
        wait_for(lambda: abs(yaw(page) - (2 * STEP_YAW - PROBE_DRAG_SMALL * DRAG_FACTOR)) <= 0.05, f"the ring must follow the pointer (yaw {yaw(page)})")
        page.mouse.move(x, y, steps=8)
        advance(page, FRAME_MS)
        wait_for(lambda: sattr(page, "yaw") == yaw_text(3), f"pointer back on its press point in several moves: drawn yaw {sattr(page, 'yaw')}, the yaw at press is {yaw_text(3)}")
        page.mouse.up()
        advance(page, TURN_MS + FRAME_MS)
        assert sattr(page, "active-world") == "basalt-beam" and sattr(page, "yaw") == yaw_text(3)
        assert_scroll_at(page, world_y(g, 3), "a drag released on its press point selects nothing")


def test_wf_reduced_motion_menu_tap_header(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/worlds/quillstack", width=W_PHONE, height=H_PHONE, reduced_motion="reduce") as page:
        menu_btn = btn(page, "Menu")
        tap(menu_btn)
        advance(page, FRAME_MS)
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        expect(lnk(menu, "Work")).to_be_focused()
        x, y = W_PHONE / 2, HEADER_PX / 2
        assert off_panel(menu, x, y), "the tap point lies on a control of the open panel"
        page.touchscreen.tap(x, y)
        advance(page, FRAME_MS)
        expect(menu).to_have_count(0)
        expect(menu_btn).to_be_focused()
        assert url_path(page) == "/worlds/quillstack"


def test_wf_portfolio_filtering_return_opened_tile(browser: Browser, app_url: str) -> None:
    opened_p, moved_to = project("tiffin-theory"), project("static-bloom")
    with opened(browser, app_url + "/work?service=packaging") as page:
        came_from = live_url(page)
        click(lnk(page.get_by_role("list", name="Projects", exact=True), opened_p["name"]))
        expect(heading(page, opened_p["name"], 1)).to_be_visible()
        click(lnk(page.get_by_role("main"), f"Next project: {moved_to['name']}"))
        expect(heading(page, moved_to["name"], 1)).to_be_visible()
        click(lnk(page.get_by_role("main"), "All work"))
        assert live_url(page) == came_from, f"All work led to {live_url(page)}, the visitor came from {came_from}"
        tile = lnk(page.get_by_role("list", name="Projects", exact=True), opened_p["name"])
        expect(tile).to_be_focused()
        assert_clear(page, tile, "the opened tile")


def test_wf_case_study_navigation_escape_after_click(browser: Browser, app_url: str) -> None:
    caps = CAPTIONS["monsoon-crate"]
    with opened(browser, app_url + "/work/monsoon-crate") as page:
        thumb = btn(page, f"Open image 2 of 4: {caps[1]}")
        click(thumb)
        dialog = page.get_by_role("dialog", name="Image viewer", exact=True)
        expect(btn(dialog, "Close viewer")).to_be_focused()
        click(dialog.get_by_role("img", name=caps[1], exact=True))
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(thumb).to_be_focused()


def test_wf_case_study_navigation_return_opened_tile(browser: Browser, app_url: str) -> None:
    caps = CAPTIONS["relaywise"]
    with opened(browser, app_url + "/work?service=brand-identity&pages=2") as page:
        came_from = live_url(page)
        click(lnk(page.get_by_role("list", name="Projects", exact=True), "Ledgerwick Advisory"))
        click(lnk(page.get_by_role("main"), "Previous project: Relaywise"))
        expect(heading(page, "Relaywise", 1)).to_be_visible()
        thumb = btn(page, f"Open image 1 of 4: {caps[0]}")
        thumb.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowLeft")
        expect(page.get_by_role("dialog", name="Image viewer", exact=True)).to_contain_text("Image 4 of 4")
        page.keyboard.press("Escape")
        expect(thumb).to_be_focused()
        click(lnk(page.get_by_role("main"), "All work"))
        assert live_url(page) == came_from, f"All work led to {live_url(page)}, the visitor came from {came_from}"
        projects = page.get_by_role("list", name="Projects", exact=True)
        wait_for(lambda: focused(lnk(projects, "Ledgerwick Advisory")) or focused(lnk(projects, "Relaywise")), "focus is on neither the opened tile nor the tile of the case study just left")
        tile = lnk(projects, "Ledgerwick Advisory") if focused(lnk(projects, "Ledgerwick Advisory")) else lnk(projects, "Relaywise")
        assert_clear(page, tile, "the returned-to tile")


ITEM_ADDRESS = "/contact?service=packaging&item=pack-range"


def item_to_step_two(page: Page, name: str, email: str) -> None:
    to_step_one(page, "Packaging")
    fill(textbox(page, "Name"), name)
    fill(textbox(page, "Email"), email)
    fill(textbox(page, "Business name"), EX_BUSINESS)
    click(btn(page, "Next"))
    expect(heading(page, "Step 2 of 4: Your project", 2)).to_be_focused()
    expect(page.get_by_role("radio", name="Packaging", exact=True)).to_be_checked()
    expect_attached(page, "Packaging range")


def step_two_to_review(page: Page) -> None:
    fill(textbox(page, "Project description"), EX_DESCRIPTION)
    click(btn(page, "Next"))
    expect(heading(page, "Step 3 of 4: Budget", 2)).to_be_focused()
    check(page.get_by_role("radio", name="Not sure yet", exact=True))
    click(btn(page, "Next"))
    expect(heading(page, "Step 4 of 4: Review", 2)).to_be_focused()


def test_wf_enquiry_steps_review_remove_item(browser: Browser, app_url: str, wiremock: Any) -> None:
    name, email = visitor("revitem")
    with opened(browser, app_url + ITEM_ADDRESS) as page:
        item_to_step_two(page, name, email)
        step_two_to_review(page)
        assert review(page)["Enquiring about"] == "Packaging range"
        remove = btn(page.get_by_role("main"), "Remove item")
        expect(remove).to_be_visible()
        click(remove)
        expect(heading(page, "Step 4 of 4: Review", 2)).to_be_visible()
        expect(remove).to_have_count(0)
        expect(attached(page)).to_have_count(0)
        assert "Enquiring about" not in review(page)
        send_and_confirm(page, app_url, wiremock, name, email)
    assert stored(app_url, email)[0]["item"] is None


APP = Path("/app")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".output", "coverage", ".cache"}


def app_files(root: Path) -> list[Path]:
    out: list[Path] = []
    stack = [root]
    for _ in range(200000):
        if not stack:
            break
        cur = stack.pop()
        for child in cur.iterdir():
            if child.is_dir():
                if child.name not in SKIP_DIRS:
                    stack.append(child)
            else:
                out.append(child)
    return out


def test_if_run_manifest() -> None:
    data = json.loads((APP / "run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) and v for v in data.values()) and data["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    text = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert missing == [], f"packages missing from notices: {missing}"
    assert [f for f in FONT_FAMILIES if f not in text] == []


def test_if_licences_allowed() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert bad == []
    text = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert "SIL OFL 1.1" in text


def test_if_datastores_only() -> None:
    files = [f for f in app_files(DEPLOYED_APP) if f.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert files == []
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "mongodb", "mongoose", "lokijs", "level"}
    assert [p.name for p in shipped_packages() if p.name in banned] == []


TRAJECTORY = Path("/logs/agent/trajectory.json")
COMPOSE_NAME = r"(?:docker-)?compose[\w.-]*\.ya?ml"
FILE_EDITOR = "file_editor"
FILE_CHANGES = {"create", "str_replace", "insert", "undo_edit"}
SHELL_WRITE = re.compile(r"(?:>>?\s*|\btee\s+(?:-a\s+)?|\bsed\s+-i\S*\s+(?:[^|;&]*\s)?|\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+)\S*" + COMPOSE_NAME)


def test_if_compose_unchanged() -> None:
    if not TRAJECTORY.exists():
        return
    data = json.loads(TRAJECTORY.read_text())
    changes = []
    for step in data.get("steps") or []:
        for call in step.get("tool_calls") or []:
            args = call.get("arguments")
            if not isinstance(args, dict):
                continue
            command = str(args.get("command") or "")
            if call.get("function_name") == FILE_EDITOR:
                if command in FILE_CHANGES and re.fullmatch(COMPOSE_NAME, Path(str(args.get("path") or "")).name):
                    changes.append(f"{command} {args.get('path')}")
            elif SHELL_WRITE.search(command):
                changes.append(command[:120])
    assert changes == [], f"compose files were changed: {changes}"


def test_if_typescript_source() -> None:
    source_dirs = {"src", "server", "client", "lib", "components", "pages", "routes"}
    js = [
        f
        for f in app_files(APP)
        if f.suffix in {".js", ".mjs", ".cjs", ".jsx"}
        and "config" not in f.name
        and source_dirs & set(f.relative_to(APP).parts[:-1])
        and not any(p.startswith(".") for p in f.relative_to(APP).parts)
    ]
    assert js == [], f"JavaScript source outside configuration: {js}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url + "/studio") as page:
        foreign: list[str] = []
        css: list[str] = []
        page.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and not same_origin(r.url, app_url) else None)
        page.on("response", lambda r: css.append(r.text()) if r.request.resource_type == "stylesheet" and same_origin(r.url, app_url) else None)
        for path in ["/", "/work/ledgerwick", "/worlds/neem-nectar", "/pricing", "/contact"]:
            page.goto(app_url + path)
        assert foreign == []
        host = urlparse(app_url).netloc
        for sheet in css:
            for m in re.finditer(r"url\(\s*['\"]?(?:https?:)?//([^/'\")]+)", sheet):
                assert m.group(1) == host, f"stylesheet references {m.group(1)}"
