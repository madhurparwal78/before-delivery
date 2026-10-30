from __future__ import annotations

import contextlib
import html
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
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urljoin, urlparse

from html.parser import HTMLParser

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    Postgres,
    addresses,
    axe,
    capture,
    changed,
    decode,
    held,
    idempotency_key,
    layout,
    open_app,
    post_json,
    same_origin,
    select,
    style,
    text,
    unique,
    until,
)


PASSWORD = "deku-demo-pw-2026"
OWNER = "owner@example.com"
MEMBER = "member@example.com"
CREATOR = "creator@example.com"
SALES = "sales@example.com"
SENDER = "studio@example.com"
NORTHLIGHT = "Northlight Studio"
INES_WORKSPACE = "Ines Duarte's workspace"
INVITE_SUBJECT = "Mara Quinn invited you to Northlight Studio on Kinora"
ACK_SUBJECT = "We received your enquiry"
SEEDED = [
    (OWNER, "Mara Quinn", "owner", NORTHLIGHT, "team"),
    (MEMBER, "Theo Park", "member", NORTHLIGHT, "team"),
    (CREATOR, "Ines Duarte", "owner", INES_WORKSPACE, "standard"),
]
BOAT = "A paper boat drifting down a rain-soaked street at dusk, cinematic"
MUG = "A ceramic mug on a linen table in soft morning light"
NEON = "Neon reflections on a wet dance floor, slow camera push"
LANTERN = "A paper lantern rising over a quiet harbour at night"

FREE_CREDITS = 125
STANDARD_CREDITS = 625
SEAT_CREDITS = 6900
SEAT_LIMIT = 9
VELA_45_PER_S = 12
TURBO_PER_S = 6
IMAGE_PER = 8
SHORT_S = 5
LONG_S = 10
FREE_PARALLEL = 2
FREE_PROJECTS = 1
NAME_MAX = 80
PROMPT_MAX = 1000
MESSAGE_MIN = 10
RENDER_MIN_S = 8
RENDER_MAX_S = 30
NORTHLIGHT_SEEDED_BALANCE = 13664
INES_SEEDED_BALANCE = 595

MARQUEE_MIN_MS = 20000
MARQUEE_MAX_MS = 45000
HERO_MAX_SCALE = 1.25
DIALOG_MIN_SCALE = 0.8
MENU_FADE_MAX_MS = 500
FOCUS_RING_PX = 2
COMPOSER_MIN_SHARE = 2 / 3
MAX_CARD_COLUMNS = 2
ASPECT_TOLERANCE = 0.02
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}


HTTP_TIMEOUT_S = 30
POLL_INTERVAL_S = 0.5
RENDER_DEADLINE_S = 45
TIMING_SLACK_S = 3
MAIL_DEADLINE_S = 20
UI_TIMEOUT_MS = 15000
READY_UI_TIMEOUT_MS = 45000
TICK_MS = 120
LOAD_TICK_MS = 1500
COPY_BOOT_S = 120
CONCURRENCY = 5
FOCUS_PRESSES = 12
NEW_PASSWORD = "harbour-lantern-2026"

PUBLIC_PATHS = [
    "/", "/product", "/pricing", "/team-plan", "/enterprise", "/enterprise-contact",
    "/model-licensing", "/examples", "/use-cases", "/workflows", "/research", "/resources", "/privacy",
]

CHROME_COPY = [
    "Enterprises get 2 months of usage free. Sign by 10/31.", "See terms", "Contact sales",
    "Creative", "Research", "Resources", "Enterprise", "Pricing", "Enterprise Sales", "Login", "Try Kinora",
    "Company", "Overview", "Use Cases", "Examples", "Team Plan", "Research Hub", "Resource Hub", "Workflows",
    "Contact Sales", "Model Licensing", "Privacy Policy", "©2026 Kinora AI, Inc.",
]

CONTACT_LABELS = ["First Name", "Last Name", "Business Email", "Company", "Company Size", "Industry",
                  "What Kinora products are you interested in?", "Creative Platform", "API",
                  "Model Weights Licensing", "Kinora Ads", "Message", "Submit", "Select an option"]

TEAM_ENTERPRISE_CARDS = [
    "Team", "Best for fast-moving teams with high production needs", "Get Team",
    "6,900 credits per seat per month, pooled across the workspace", "Everything in Max",
    "Up to 100 shared projects", "One shared credit pool", "24 parallel generations", "Two to nine seats",
    "Enterprise", "Built for organizations: security, privacy, admin controls and SSO", "Talk to Sales",
    "Pricing and credits sized to your organization", "Everything in Team", "Unlimited members and workspaces",
    "Custom SSO, SOC 2 and ISO/IEC 27001, no training on your data",
]

PUBLIC_COPY = {
    "/": ["Building Real-World Intelligence",
          "Kinora is building foundational Real-World Intelligence that can understand, simulate and act in the world. We offer products and services built on-top of this intelligence to empower individuals and organizations to do more in the world.",
          "Try Kinora for free",
          "We partner with the world's leading organizations to advance their industries:",
          "Three platforms built on-top of the same Real-World Intelligence models", "Kinora Creative",
          "Your complete Creative Suite with everything you need, to make anything you want.",
          "Try now", "Learn more", "For Enterprise",
          "Used by 60m+ creatives around the world. Try free, cancel anytime.", "Kinora Dev", "Kinora Robotics",
          "How Kinora is Used", "Create with Agent", "Build your own Workflows", "Enterprise-grade",
          "The World's Best Models", "Kinora Research", "Vela 4.5", "General World Models", "Research Hub",
          "See the latest from Kinora"],
    "/product": ["A new frontier for video generation.", "Get Started",
                 "Used by 60M+ users globally - try today and cancel anytime",
                 "Every model you need to make anything you want.", "Vela 4.5", "Vela 4 Turbo", "Vela Image 4",
                 "Dozens of tools. Endless ways to create.", "Transform Video", "Mood Boards", "Virtual Staging",
                 "Character Performance", "Virtual Try-On", "Design Explorations", "Storyboarding", "Animatics",
                 "Generate Yourself", "Visual Effects", "Explore other apps", "Remove from Video",
                 "Reshoot Product", "Upscale Video", "Add Dialogue", "Change Image Style", "Add Performance",
                 "Change Backdrop", "Change Time of Day", "Relight Scene",
                 "Remove anything from any video with a simple prompt."],
    "/pricing": ["Choose the Right Plan for You", "Trusted by 60M+ creators and leading enterprises",
                 "Individual", "Team & Enterprise", "API", "Monthly", "Yearly", "2 months free",
                 "Free", "Standard", "Pro", "Max", "Popular", "Best value", "Credits roll over 1 mo.",
                 "$0", "$12", "$15", "$28", "$35", "$76", "$95", "Free forever.",
                 "Billed annually. Save $36/year.", "Billed annually. Save $84/year.",
                 "Billed annually. Save $228/year.", "125 credits (one time)", "625 credits /mo",
                 "2,250 credits /mo", "9,500 credits /mo",
                 "For people looking to explore Kinora's AI Tools", "For curious creators trying AI video",
                 "For creators leveling up their craft", "Best value for heavy solo usage",
                 "Start Free", "Get Standard", "Get Pro", "Get Max",
                 "A selection of generative creative models to test concepts", "Up to 1 project",
                 "2 generations at a time", "Access to all Vela models", "5 generations at a time",
                 "Up to 3 projects", "No watermarks", "Everything in Standard", "15 generations at a time",
                 "Up to 5 projects", "Early access to new models", "20 generations at a time",
                 "Up to 10 projects"],
    "/team-plan": ["Kinora Team",
                   "Grow your business faster with more on-brand campaigns, product shots and social, made in a fraction of the time.",
                   "One place for your team's work", "Manage the whole team from one balance",
                   "Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat.",
                   "Bring Kinora to the tools you already use", "For every team with creative needs",
                   "Marketing teams", "Studios and agencies", "In-house creative", "Frequently asked questions",
                   "What is the Team plan?", "How does the shared credit pool work?",
                   "Can I change the number of seats?", "When should we consider Enterprise instead?"],
    "/enterprise": ["Production-ready AI", "Made for Enterprise",
                    "Our full suite of creative AI tools can help your teams realize bigger ideas with smaller budgets and timelines.",
                    "Contact Sales", "Why Enterprises Choose Kinora", "2 weeks",
                    "Saved on production timeline despite no access to on-camera talent", "80%",
                    "Cost savings vs traditional VFX Pipeline", "Built for Enterprise", "We don't train on your data",
                    "SOC 2 Type 2", "Customizable access & permissions", "Full ownership of your outputs",
                    "Single Sign On (SSO)"],
    "/enterprise-contact": ["Contact our enterprise team.",
                            "Tell us what you're working on - we'll be in touch within two business days.",
                            "Tell us more about your use case."],
    "/model-licensing": ["Model licensing", "Create your own frontier.",
                         "License state of the art Kinora model weights. Fine-tune on your own data, self-host on your infrastructure and commercialize what you create.",
                         "Talk to our team", "Start at the frontier.", "Tune it to you.", "Run within your walls.",
                         "White glove service.", "Full Name", "Business Email", "Company", "Company Size", "Industry",
                         "Message", "Submit"],
    "/examples": ["Explore all examples", "All", "Product ads", "Animated stories", "UGC", "From a link",
                  "8 examples"],
    "/use-cases": ["AI video for whatever you make", "Find your use case", "Social Media Content Creation",
                   "Product shots", "Packaging & Retail Visualization", "Automotive Product Photography",
                   "UGC ads"],
    "/workflows": ["Introducing Kinora Workflows", "Why Workflows?", "Combine multiple models, modalities and tasks",
                   "Create reusable templates", "Automate repetitive tasks", "Featured Workflows",
                   "Image Style Generator", "Image Variations", "Storyboard Creator", "Virtual Try On",
                   "Custom Instructions Workshop", "Image to Text", "Hair Salon", "Animatic Generator", "Style Blend",
                   "Do workflows take credits?",
                   "Yes. Media model nodes and LLM nodes use credits when they run."],
    "/research": ["Building general-purpose multimodal", "simulators of the world."],
    "/resources": ["Featured", "All Resources"],
    "/privacy": ["hashed password", "cookie"],
    "/signup": ["Create your account", "Name", "Email", "Password", "Sign up"],
    "/login": ["Welcome to Kinora", "Don't have an account? Sign up for free", "Email", "Password",
               "Log in"],
}
INVITE_PROBE_TOKEN = "no-such-invitation-token"

EXPECTED_PLANS = [
    ("free", "Free", 0, 0, 125, 2, 1),
    ("standard", "Standard", 1500, 1200, 625, 5, 3),
    ("pro", "Pro", 3500, 2800, 2250, 15, 5),
    ("max", "Max", 9500, 7600, 9500, 20, 10),
    ("team", "Team", 6900, 5500, 6900, 24, 100),
    ("enterprise", "Enterprise", None, None, None, None, None),
]
EXPECTED_MODELS = {
    "vela-4.5": ("Vela 4.5", "video", 12),
    "vela-4-turbo": ("Vela 4 Turbo", "video", 6),
    "vela-image-4": ("Vela Image 4", "image", 8),
}

EXAMPLES = [
    ("Product shot to finished commercial", "product-ads",
     "Make one complete stovetop coffee commercial for this kettle: onto the blue flame, water in, the steam curling up, then the pour and the cup in morning light. One kitchen, every shot in the same light."),
    ("Five-shot brand film from one cup", "product-ads",
     "A five-shot sequence: a coffee cup on a sunlit café table, small clouds rising from the steam and carrying the camera over misty hills of coffee plants, then back to the table."),
    ("Product sheet to brand spot", "product-ads",
     "Make a thirty-second cereal ad from these three boxes: a child's imagination turns the cereal rings into giant hoops rolling across a beach at sunset, then back to the breakfast table."),
    ("Animated story with consistent characters", "animated-stories",
     "Turn this tomato soldier into a twenty-second animated parody: he storms the beach with his vegetable squad to get the ketchup to the fries. Keep the characters consistent in every shot, no text on screen."),
    ("Animated comedy scene", "animated-stories",
     "An undercover escape scene in a soft animated style: the chicken looks both ways, runs over to a sleeping dog, looks around, then taps him with its beak."),
    ("UGC-style product video", "ugc",
     "Make a fifteen-second vertical ad for this chair: a guy films himself in his apartment, flops into it, hard cuts, handheld, real reactions."),
    ("UGC demo video", "ugc",
     "Make a fifteen-second clip for this hose-end lawn sprayer: a person filming himself in his own front yard at golden hour, hooking it up, spraying the lawn and talking to camera."),
    ("Product page to cinematic spot", "from-a-link",
     "Make a fifteen-second cinematic commercial from this product page for a running shoe: macro details, a slow orbit, dramatic red and black lighting, ending on the full silhouette."),
]

TEMPLATES = [
    ("Make video ad for socials", "A fifteen second vertical ad for a reusable water bottle: a cyclist pauses at golden hour, drinks, and rides on"),
    ("Reshoot your product", "A glass perfume bottle on wet black stone, slow orbit, soft rim light"),
    ("Build creative from a brief", "A cosy autumn launch film for a knitwear label: a cabin porch, falling leaves, warm window light"),
    ("Generate A/B variants", "A sneaker on a concrete plinth, first in hard noon light, then in soft overcast light"),
    ("Create seasonal campaign", "A winter window display for a bookshop, snow drifting past warm lamplight"),
]

COMPANY_SIZES = ["1-200", "201-1,000", "1,001-5,000", "5,001-10,000", "10,001+"]
INDUSTRIES = ["Architecture & Real Estate", "Automotive", "Creative Agency", "Financial Services", "Gaming",
              "Healthcare", "Media & Entertainment", "Professional Services", "Consumer Goods & Retail",
              "Software & Telecom", "Travel & Hospitality", "Other"]
CONTACT_REQUIRED = ["First Name", "Last Name", "Business Email", "Company", "Company Size", "Industry", "Message"]


RECORDER_JS = r"""
(() => {
  if (window.__motion) return;
  const rec = [];
  window.__motion = rec;
  const add = (a) => { if (a && a.effect && !rec.includes(a)) rec.push(a); };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); add(a); return a; };
  const grab = (event) => {
    const t = event.target;
    if (t && t.getAnimations) t.getAnimations({ subtree: true }).forEach(add);
  };
  for (const name of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(name, grab, true);
})()
"""

SAMPLE_JS = r"""
([target, points]) => {
  const out = [];
  const fadedEdges = (start) => {
    let n = start;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/gradient/.test(s.maskImage || '') || /gradient/.test(s.webkitMaskImage || '')) return true;
      for (const p of ['::before', '::after']) if (/gradient/.test(getComputedStyle(n, p).backgroundImage)) return true;
      const siblings = n.parentElement ? Array.from(n.parentElement.children) : [];
      for (const sib of siblings) if (sib !== n && /gradient/.test(getComputedStyle(sib).backgroundImage)) return true;
    }
    return false;
  };
  for (const a of (window.__motion || [])) {
    const eff = a.effect;
    const el = eff && eff.target;
    if (!el || !el.isConnected) continue;
    if (target && !(el === target || el.contains(target) || target.contains(el))) continue;
    const pseudo = eff.pseudoElement || null;
    const timing = eff.getComputedTiming();
    const delay = timing.delay || 0;
    const duration = typeof timing.duration === 'number' ? timing.duration : 0;
    const finite = Number.isFinite(timing.iterations);
    const span = finite ? duration * timing.iterations : duration;
    const state = a.playState;
    const before = a.currentTime;
    const samples = [];
    a.pause();
    for (let i = 0; i <= points; i++) {
      a.currentTime = delay + (span * i) / points;
      const cs = getComputedStyle(el, pseudo);
      const box = pseudo ? null : el.getBoundingClientRect();
      let m;
      try { m = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : new DOMMatrix(); } catch (e) { m = new DOMMatrix(); }
      samples.push({ opacity: parseFloat(cs.opacity), left: box ? box.left : null, top: box ? box.top : null,
        width: box ? box.width : null, height: box ? box.height : null, a: m.a, b: m.b, d: m.d, e: m.e, f: m.f,
        translate: cs.translate, scale: cs.scale, rotate: cs.rotate, bg: cs.backgroundPosition,
        cssWidth: parseFloat(cs.width) || 0 });
    }
    if (finite) a.finish(); else { a.currentTime = before; if (state === 'running') a.play(); }
    out.push({ duration, iterations: finite ? timing.iterations : -1, delay, pseudo, state, samples,
      text: (el.textContent || '').slice(0, 2000), faded: fadedEdges(el) });
  }
  return out;
}
"""

RESET_MOTION_JS = "() => { if (window.__motion) window.__motion.length = 0; }"
FINISH_JS = ("() => document.getAnimations().forEach((a) => { const t = a.effect && a.effect.getComputedTiming();"
             " if (t && Number.isFinite(t.endTime)) a.finish(); })")
ENDLESS_JS = ("() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect &&"
              " !Number.isFinite(a.effect.getComputedTiming().iterations)).map((a) => String(a.animationName ||"
              " a.transitionProperty || a.id || 'animation'))")
RING_LOOK_FN = r"""
  const ringLook = (n, px) => ['', '::before', '::after'].map((ps) => {
    const cs = getComputedStyle(n, ps || null);
    if (ps && (cs.content === 'none' || cs.content === 'normal')) return '';
    const drawn = (cs.outlineStyle !== 'none' && (parseFloat(cs.outlineWidth) || 0) >= px) || (cs.boxShadow && cs.boxShadow !== 'none')
      || (cs.borderTopStyle !== 'none' && (parseFloat(cs.borderTopWidth) || 0) >= px);
    return drawn ? [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor].join('|') : '';
  });
"""
FOCUS_JS = (r"""
() => {
  document.getAnimations().forEach((a) => { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); });
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const ringed = (n) => {
    if (!n) return false;
    const cs = getComputedStyle(n);
    return (cs.outlineStyle !== 'none' && (parseFloat(cs.outlineWidth) || 0) >= %d) || (cs.boxShadow && cs.boxShadow !== 'none');
  };
""" + RING_LOOK_FN + r"""
  const nodes = [el, el.nextElementSibling, el.previousElementSibling];
  for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) nodes.push(p);
  const kept = nodes.filter(Boolean);
  window.__ring = { el, nodes: kept, looks: kept.map((n) => ringLook(n, %d)) };
  return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60),
           ring: ringed(el) || ringed(el.parentElement) || ringed(el.nextElementSibling) };
}
""") % (FOCUS_RING_PX, FOCUS_RING_PX)
RING_LEFT_JS = (r"""
() => {
  document.getAnimations().forEach((a) => { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); });
  const r = window.__ring;
  if (!r || document.activeElement === r.el) return false;
""" + RING_LOOK_FN + r"""
  return r.nodes.some((n, i) => ringLook(n, %d).some((now, j) => r.looks[i][j] && r.looks[i][j] !== now));
}
""") % FOCUS_RING_PX
SCOPED_JS = r"""
([buttons, text, name]) => buttons.map((btn) => {
  let el = btn;
  while (el && !(el.textContent || '').includes(text)) el = el.parentElement;
  if (!el) return false;
  const same = Array.from(el.getElementsByTagName('button')).concat(Array.from(el.getElementsByTagName('a')))
    .filter((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === name);
  return same.length === 1;
})
"""
STRUCK_JS = r"""
(price) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.includes(price) || !n.parentElement.getClientRects().length) continue;
    let el = n.parentElement;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (el.tagName === 'S' || el.tagName === 'DEL' || getComputedStyle(el).textDecorationLine.includes('line-through')) return true;
    }
  }
  return false;
}
"""
TIED_JS = r"""
(el) => {
  const ids = ((el.getAttribute('aria-describedby') || '') + ' ' + (el.getAttribute('aria-errormessage') || '')).split(/\s+/).filter(Boolean);
  const nodes = ids.map((i) => document.getElementById(i)).filter(Boolean);
  const announced = (n) => { for (let p = n; p; p = p.parentElement) { const r = p.getAttribute('role'); if (r === 'alert' || r === 'status' || p.hasAttribute('aria-live')) return true; } return false; };
  return { described: nodes.map((n) => n.textContent || '').join(' ').trim(), announced: nodes.some(announced),
           invalid: el.getAttribute('aria-invalid') === 'true' };
}
"""
PICTURE_JS = r"""
(p) => Array.from(document.images).some((i) => i.alt === p && i.complete) ||
  Array.from(document.getElementsByTagName('svg')).some((s) => s.getAttribute('role') === 'img' && (s.getAttribute('aria-label') || '') === p)
"""


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = first if "@" in first else second
    tag = second if email == first else first
    return tag, email


def pause(seconds: float) -> None:
    threading.Event().wait(seconds)


def http(method: str, base: str, path: str, token: str | None = None, body=None, headers=None) -> httpx.Response:
    hdrs = dict(headers or {})
    if token is not None:
        hdrs["Authorization"] = f"Bearer {token}"
    return httpx.request(method, base + path, json=body, headers=hdrs, timeout=HTTP_TIMEOUT_S)


def login(base: str, email: str, password: str = PASSWORD) -> str:
    r = http("POST", base, "/api/auth/login", body={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def me(base: str, token: str) -> dict:
    r = http("GET", base, "/api/me", token)
    assert r.status_code == 200, r.text
    return r.json()


def signup(base: str, prefix: str = "visitor", name: str | None = None) -> dict:
    tag, email = fresh(prefix)
    person = name or f"Visitor {tag}"[:NAME_MAX]
    r = http("POST", base, "/api/auth/signup", body={"name": person, "email": email, "password": NEW_PASSWORD})
    assert r.status_code == 201, f"signup: {r.status_code} {r.text}"
    token = r.json()["token"]
    profile = me(base, token)
    projects = http("GET", base, "/api/projects", token).json()
    return {"tag": tag, "email": email, "name": person, "token": token, "user": r.json()["user"],
            "workspace": profile["workspace"]["id"], "project": projects[0]["id"]}


def gen_body(project_id, model="vela-4-turbo", prompt="probe", duration=SHORT_S, image_count=None, aspect="16:9"):
    if model == "vela-image-4":
        return {"project_id": project_id, "model": model, "prompt": prompt, "duration": None,
                "image_count": image_count or 1, "aspect": aspect}
    return {"project_id": project_id, "model": model, "prompt": prompt, "duration": duration,
            "image_count": None, "aspect": aspect}


def start(base: str, token: str, body: dict, key: str | None = None) -> httpx.Response:
    return post_json(base, "/api/generations", body, key, Authorization=f"Bearer {token}")


def together(n: int, fn):
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(run, range(n)))


def lit(value) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def q(sql: str) -> list[dict]:
    return Postgres().rows(sql)


def ws_sum(workspace) -> int:
    return int(q(f"SELECT COALESCE(SUM(amount), 0) AS total FROM credit_entries WHERE workspace_id = {lit(workspace)}")[0]["total"])


def ws_count(table: str, workspace, where: str = "TRUE") -> int:
    return int(q(f"SELECT COUNT(*) AS n FROM {table} WHERE workspace_id = {lit(workspace)} AND {where}")[0]["n"])


def entries_for(gen_id, kind: str) -> list[dict]:
    return q(f"SELECT amount, balance_after FROM credit_entries WHERE generation_id = {lit(gen_id)} AND kind = {lit(kind)}")


def workspace_id(name: str):
    return q(f"SELECT id FROM workspaces WHERE name = {lit(name)}")[0]["id"]


def seeded_ids() -> dict:
    nl = workspace_id(NORTHLIGHT)
    ines = workspace_id(INES_WORKSPACE)
    spring = q(f"SELECT id FROM projects WHERE workspace_id = {lit(nl)} AND name = 'Spring campaign'")[0]["id"]
    music = q(f"SELECT id FROM projects WHERE workspace_id = {lit(ines)} AND name = 'Music video'")[0]["id"]
    boat = q(f"SELECT id FROM generations WHERE prompt = {lit(BOAT)}")[0]["id"]
    mug = q(f"SELECT id FROM generations WHERE prompt = {lit(MUG)}")[0]["id"]
    neon = q(f"SELECT id FROM generations WHERE prompt = {lit(NEON)}")[0]["id"]
    return {"northlight": nl, "ines": ines, "spring": spring, "music": music, "boat": boat, "mug": mug, "neon": neon}


def unknown_like(value):
    return 2_000_000_000 if isinstance(value, int) else "00000000-0000-4000-8000-000000000000"


def wait_status(base: str, token: str, gen_id, wanted: set[str], deadline_s: float = RENDER_DEADLINE_S) -> dict:
    end = time.monotonic() + deadline_s
    while True:
        r = http("GET", base, f"/api/generations/{gen_id}", token)
        assert r.status_code == 200, r.text
        if r.json()["status"] in wanted:
            return r.json()
        assert time.monotonic() < end, f"generation {gen_id} stayed {r.json()['status']}"
        pause(POLL_INTERVAL_S)


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def inbox(mail: Mailpit, address: str, subject: str | None = None, expected: int = 1) -> list[dict]:
    end = time.monotonic() + (MAIL_DEADLINE_S if expected else 0)
    while True:
        found = [m for m in mail.messages()
                 if address.lower() in [a.lower() for a in addresses(m.get("To"))]
                 and (subject is None or m.get("Subject") == subject)]
        if len(found) >= expected or time.monotonic() > end:
            return found


def invite(base: str, token: str, email: str) -> httpx.Response:
    return http("POST", base, "/api/team/invitations", token, {"email": email})


def invitation_token(email: str) -> str:
    rows = q(f"SELECT token FROM invitations WHERE lower(email) = lower({lit(email)}) AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    assert rows, f"no pending invitation stored for {email}"
    return rows[0]["token"]


def tidy_team(base: str, emails: list[str]) -> None:
    owner = login(base, OWNER)
    team = http("GET", base, "/api/team", owner).json()
    low = {e.lower() for e in emails}
    for inv in team.get("invitations", []):
        if inv["email"].lower() in low:
            http("DELETE", base, f"/api/team/invitations/{inv['id']}", owner)
    for person in team.get("members", []):
        if person["email"].lower() in low and person["role"] == "member":
            http("DELETE", base, f"/api/team/members/{person['id']}", owner)


def member_id(base: str, token: str, email: str):
    team = http("GET", base, "/api/team", token).json()
    return next(p["id"] for p in team["members"] if p["email"].lower() == email.lower())


def money(n: int) -> str:
    return f"{n:,} credits"


def amount_re(n: int) -> re.Pattern:
    return re.compile(r"(?<![\d,])" + re.escape(money(n)))


def norm(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u2212", "-").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", s).strip()


def visible_text(src: str) -> str:
    src = re.sub(r"<(script|style|template|noscript)\b.*?</\1>", " ", src, flags=re.S | re.I)
    return norm(html.unescape(re.sub(r"<[^>]+>", " ", src)))


def svg_ratio(svg: str) -> float:
    tag = re.search(r"<svg\b[^>]*>", svg, re.S)
    assert tag, "output is not an SVG"
    head = tag.group(0)
    vb = re.search(r'viewBox\s*=\s*["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', head)
    if vb:
        return float(vb.group(1)) / float(vb.group(2))
    w = re.search(r'\bwidth\s*=\s*["\']([\d.]+)', head)
    h = re.search(r'\bheight\s*=\s*["\']([\d.]+)', head)
    assert w and h, "SVG states no size"
    return float(w.group(1)) / float(h.group(1))


def output(base: str, token: str, gen_id) -> httpx.Response:
    return http("GET", base, f"/api/generations/{gen_id}/output", token)


def live(page: Page) -> None:
    with contextlib.suppress(Exception):
        page.clock.resume()


@contextlib.contextmanager
def app_page(browser: Browser, url: str, **kw):
    cm = open_app(browser, url, **kw)
    if hasattr(cm, "__enter__"):
        with cm as p:
            yield p
    else:
        try:
            yield next(cm)
        finally:
            with contextlib.suppress(StopIteration):
                next(cm)


@contextlib.contextmanager
def hold(page: Page, glob: str):
    cm = held(page, glob)
    if hasattr(cm, "__enter__"):
        with cm as gate:
            yield gate
    else:
        try:
            yield next(cm)
        finally:
            with contextlib.suppress(StopIteration):
                next(cm)


def release(gate) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def visible_items(loc: Locator) -> list[Locator]:
    found = []
    for i in range(loc.count()):
        with contextlib.suppress(PlaywrightError):
            if loc.nth(i).is_visible():
                found.append(loc.nth(i))
    return found


def shown(loc: Locator, timeout: int = UI_TIMEOUT_MS) -> Locator:
    end = time.monotonic() + timeout / 1000
    while True:
        items = visible_items(loc)
        if items:
            return items[0]
        if time.monotonic() > end:
            return loc.first
        pause(POLL_INTERVAL_S)


def none_visible(loc: Locator, timeout: int = UI_TIMEOUT_MS) -> None:
    end = time.monotonic() + timeout / 1000
    while visible_items(loc):
        assert time.monotonic() < end, "an element that should be hidden is still visible"
        pause(POLL_INTERVAL_S)


def panel_changes(page: Page, before: str, timeout: int = UI_TIMEOUT_MS) -> None:
    end = time.monotonic() + timeout / 1000
    while shown(page.get_by_role("tabpanel")).inner_text() == before:
        assert time.monotonic() < end, "the tab panel did not change"
        pause(POLL_INTERVAL_S)


def see(page: Page, what, timeout: int = UI_TIMEOUT_MS) -> None:
    expect(shown(page.get_by_text(what))).to_be_visible(timeout=timeout)


def page_text(page: Page) -> str:
    return norm(page.evaluate("() => document.body.innerText"))


def ui_login(page: Page, base: str, email: str, password: str = PASSWORD) -> None:
    page.goto(base + "/login")
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Log in").click()
    expect(page).to_have_url(re.compile(r"/studio/?(\?.*)?(#.*)?$"), timeout=UI_TIMEOUT_MS)


def link_or_button(scope, name: str) -> Locator:
    return scope.get_by_role("link", name=name, exact=True).or_(scope.get_by_role("button", name=name, exact=True))


def header_items(page: Page, role: str, name: str) -> list[Locator]:
    found = []
    loc = page.get_by_role(role, name=name, exact=True)
    for i in range(loc.count()):
        box = loc.nth(i).bounding_box()
        if box and box["y"] < 400 and box["height"] > 0:
            found.append(loc.nth(i))
    return found


def path_of(base: str, href: str | None) -> str:
    return urlparse(urljoin(base + "/", href or "")).path


def scoped(page: Page, role: str, name: str, inside_text: str) -> Locator:
    loc = page.get_by_role(role, name=name, exact=True)
    expect(loc.first).to_be_attached(timeout=UI_TIMEOUT_MS)
    flags = page.evaluate(SCOPED_JS, [loc.element_handles(), inside_text, name])
    assert True in flags, f"no {name!r} {role} beside {inside_text!r}"
    return loc.nth(flags.index(True))


def record(page: Page) -> None:
    page.add_init_script(RECORDER_JS)
    page.evaluate(RECORDER_JS)


def motion(page: Page, target=None, points: int = 12) -> list[dict]:
    return page.evaluate(SAMPLE_JS, [target, points])


def finish_all(page: Page) -> None:
    page.evaluate(FINISH_JS)


def spread(m: dict, key: str) -> float:
    vals = [s[key] for s in m["samples"] if isinstance(s.get(key), (int, float))]
    return max(vals) - min(vals) if vals else 0.0


def varies_str(m: dict, key: str) -> bool:
    return len({s.get(key) for s in m["samples"]}) > 1


def ui_signup(page: Page, name: str, email: str, password: str = NEW_PASSWORD) -> None:
    page.get_by_label("Name", exact=True).fill(name)
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign up").click()


def contact_body(email: str, company: str, /, **over) -> dict:
    body = {"source": "contact", "first_name": "Lena", "last_name": "Hart", "full_name": None,
            "email": email, "company": company, "company_size": "201-1,000", "industry": "Gaming",
            "products": ["creative-platform", "api"],
            "message": "We want launch films for three product lines this spring."}
    body.update(over)
    return body


def test_health_returns_200_on_the_published_port(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    port = os.environ.get("APP_PUBLIC_PORT")
    if port and urlparse(app_url).port:
        assert str(urlparse(app_url).port) == port


USE_CASE_CARDS = ["Social Media Content Creation", "Product shots", "Packaging & Retail Visualization",
                  "Automotive Product Photography", "UGC ads"]
APP_TILES = ["Remove from Video", "Reshoot Product", "Upscale Video", "Add Dialogue", "Change Image Style",
             "Add Performance", "Change Backdrop", "Change Time of Day", "Relight Scene"]
CHROME_SET = {norm(c).lower() for c in CHROME_COPY} | {"kinora"}


LEAVES_FN = r"""
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const chrome = (n) => n.closest('footer,header,nav,[role=contentinfo],[role=banner]');
  const leaves = (root, skip) => { const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest('script,style,template') || (skip && skip.contains(n))) continue;
      const t = clean(n.textContent); if (t) out.push(t); } return out; };
"""

NAMED_JS = r"""
(names) => {
""" + LEAVES_FN + r"""
  return names.map((name) => {
    const all = Array.from(document.body.querySelectorAll('*')).filter((e) => !chrome(e) && e.getClientRects().length && clean(e.textContent) === name);
    const label = all.find((e) => !all.some((o) => o !== e && e.contains(o)));
    if (!label) return { title: name, parts: [] };
    const others = names.filter((o) => o !== name);
    let card = label;
    while (card.parentElement && card.parentElement !== document.body && !others.some((o) => clean(card.parentElement.textContent).includes(o))) card = card.parentElement;
    return { title: name, parts: leaves(card, label).filter((t) => t !== name) };
  });
}
"""

SECTION_JS = r"""
([start, stop]) => {
""" + LEAVES_FN + r"""
  const seen = (e) => e && e.getClientRects().length;
  const all = Array.from(document.body.querySelectorAll('*')).filter((e) => !chrome(e) && seen(e) && clean(e.textContent).includes(start));
  const label = all.find((e) => !all.some((o) => o !== e && e.contains(o)));
  if (!label) return null;
  const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const p = n.parentElement; const t = clean(n.textContent);
    if (!t || !p || label.contains(n) || !(label.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (stop && t === stop) break;
    if (p.closest('script,style,template') || chrome(p) || !seen(p)) continue;
    out.push(t);
  }
  return out;
}
"""

CARD_SECTIONS = [
    ("/", "See the latest from Kinora", None),
    ("/research", "simulators of the world.", None),
    ("/resources", "Featured", "All Resources"),
    ("/resources", "All Resources", None),
]


def squash(s: str) -> str:
    return re.sub(r"\s+", "", norm(s))


def test_public_pages_serve_copy_in_first_html(page, app_url):
    extra = {
        "/examples": [e[0] for e in EXAMPLES] + [e[2] for e in EXAMPLES],
        "/enterprise-contact": CONTACT_LABELS,
        "/enterprise": CONTACT_LABELS,
        "/team-plan": TEAM_ENTERPRISE_CARDS,
    }
    failures = {}
    for path, phrases in PUBLIC_COPY.items():
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"{path}: {r.status_code}"
        words = visible_text(r.text)
        wanted = phrases + extra.get(path, []) + (CHROME_COPY if path in PUBLIC_PATHS else [])
        missing = [p for p in wanted if squash(p) not in squash(words)]
        if missing:
            failures[path] = missing
    assert not failures, f"first HTML lacks copy: {failures}"

    first_html = {path: squash(visible_text(httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).text))
                  for path in ["/product", "/use-cases"]}
    absent: dict[str, list[str]] = {}

    def require(path: str, label: str, cards: list[dict]) -> None:
        pieces = [t for c in cards for t in [c["title"], *c["parts"]] if t]
        lost = [t for t in pieces if squash(t) not in first_html[path]]
        if lost:
            absent[f"{path} {label}"] = lost[:3]

    live(page)
    page.goto(app_url + "/product")
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    tiles = page.evaluate(NAMED_JS, APP_TILES)
    assert all(c["parts"] for c in tiles), f"an app tile lacks its line: {[c['title'] for c in tiles if not c['parts']]}"
    require("/product", "app tiles", tiles)

    page.goto(app_url + "/use-cases")
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    uses = page.evaluate(NAMED_JS, USE_CASE_CARDS)
    assert all(c["parts"] for c in uses), f"a use case lacks its line: {[c['title'] for c in uses if not c['parts']]}"
    require("/use-cases", "use case cards", uses)

    for path, start, stop in CARD_SECTIONS:
        if path not in first_html:
            first_html[path] = squash(visible_text(httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).text))
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        pieces = page.evaluate(SECTION_JS, [start, stop])
        assert pieces is not None, f"{path}: no {start!r} section"
        assert pieces, f"{path} {start!r}: no visible text under the heading"
        lost = [t for t in pieces if squash(t) not in first_html[path]]
        if lost:
            absent[f"{path} {start}"] = lost[:3]
    assert not absent, f"card copy appears only after the first HTML: {absent}"
    owner = login(app_url, OWNER)
    _, email = fresh("firsthtml")
    try:
        assert invite(app_url, owner, email).status_code == 201
        r = httpx.get(app_url + f"/invite/{invitation_token(email)}", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, r.status_code
    finally:
        tidy_team(app_url, [email])
    home = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    h1s = re.findall(r"<h1\b[^>]*>(.*?)</h1>", home, re.I | re.S)
    assert len(h1s) == 1, f"home has {len(h1s)} level-one headings"
    assert visible_text(h1s[0]) == "Building Real-World Intelligence"


NOT_FOUND_PROBES = ["/no-such-page-kinora", "/pricing/no-such-plan"]


def test_unknown_routes_return_not_found_page(page, app_url):
    live(page)
    for path in NOT_FOUND_PROBES:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404
        resp = page.goto(app_url + path)
        assert resp is not None and resp.status == 404
        expect(page.get_by_role("heading", name="Page not found")).to_be_visible()
        see(page, "We could not find that page.")
        back = page.get_by_role("link", name="Back to home")
        assert path_of(app_url, back.get_attribute("href")) == "/"
        expect(shown(page.get_by_role("link", name="Kinora", exact=True))).to_be_visible()
        expect(shown(page.get_by_role("button", name="Creative", exact=True))).to_be_visible()
        expect(page.get_by_text("©2026 Kinora AI, Inc.").first).to_be_attached()
    page.get_by_role("link", name="Back to home").click()
    expect(page.get_by_role("heading", level=1, name="Building Real-World Intelligence")).to_be_visible()
    assert httpx.get(app_url + "/api/no-such-endpoint", timeout=HTTP_TIMEOUT_S).status_code == 404


def test_privacy_page_states_data_handling(app_url):
    r = httpx.get(app_url + "/privacy", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    words = visible_text(r.text).lower()
    for keyword in ["name", "email", "hashed password", "workspace", "projects", "generations", "credit history",
                    "enquiry", "invitation", "staff", "members", "cookie"]:
        assert keyword in words, f"privacy page does not mention {keyword!r}"
    assert re.search(r"signed[ -]in", words), "privacy page does not say the cookie keeps a person signed in"


def test_pages_pass_wcag_audit(page, app_url):
    live(page)
    for path in PUBLIC_PATHS + ["/login", "/signup"]:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        finish_all(page)
        axe(page)
    ids = seeded_ids()
    ui_login(page, app_url, OWNER)
    for path in ["/studio", "/studio/projects", f"/studio/projects/{ids['spring']}",
                 f"/studio/generations/{ids['boat']}", "/studio/credits", "/studio/team"]:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        with contextlib.suppress(PlaywrightError):
            page.wait_for_load_state("networkidle", timeout=5000)
        finish_all(page)
        axe(page)
    page.goto(app_url + f"/studio/projects/{ids['spring']}")
    expect(shown(page.get_by_role("img", name=BOAT))).to_be_visible(timeout=UI_TIMEOUT_MS)
    expect(shown(page.get_by_role("img", name=MUG))).to_be_visible(timeout=UI_TIMEOUT_MS)
    assert page.evaluate("() => Array.from(document.images).every((i) => i.hasAttribute('alt'))")


def test_keyboard_focus_visible_and_dialog_traps_focus(page, app_url):
    live(page)
    page.goto(app_url + "/pricing")
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    stops = []
    for _ in range(FOCUS_PRESSES):
        page.keyboard.press("Tab")
        info = page.evaluate(FOCUS_JS)
        if info:
            stops.append(info)
            ring = info["ring"]
            if not ring:
                page.keyboard.press("Shift+Tab")
                ring = page.evaluate(RING_LEFT_JS)
                page.keyboard.press("Tab")
            assert ring, f"no visible focus ring on {info['name']!r}"
    assert stops, "Tab reached no control"
    ui_login(page, app_url, OWNER)
    page.goto(app_url + "/studio/projects")
    opener = page.get_by_role("button", name="New project", exact=True).first
    opener.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name="New project")
    expect(dialog).to_be_visible()
    assert dialog.evaluate("(d) => d.contains(document.activeElement)"), "focus did not move into the dialog"
    for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
        page.keyboard.press(key)
        assert dialog.evaluate("(d) => d.contains(document.activeElement)"), f"{key} left the dialog"
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    assert opener.evaluate("(el) => el === document.activeElement"), "focus did not return to New project"


def test_phone_width_reflows_without_sideways_scroll(page, app_url):
    live(page)
    for size in (TABLET, DESKTOP, PHONE):
        page.set_viewport_size(size)
        for path in PUBLIC_PATHS + ["/login", "/signup"]:
            page.goto(app_url + path)
            expect(page.get_by_role("heading").first).to_be_visible()
            finish_all(page)
            layout(page)
    page.goto(app_url + "/")
    page.get_by_role("button", name="Menu", exact=True).click()
    drawer = page.get_by_role("dialog").first
    expect(drawer).to_be_visible()
    for name in ["Pricing", "Examples", "Research Hub", "Workflows", "Model Licensing",
                 "Enterprise Sales", "Login", "Try Kinora"]:
        expect(link_or_button(drawer, name).first).to_be_attached()
    page.keyboard.press("Escape")
    page.goto(app_url + "/enterprise-contact")
    panel = shown(page.get_by_text("Contact our enterprise team.")).bounding_box()
    form = page.get_by_role("heading", name="Tell us more about your use case.").bounding_box()
    assert panel and form and panel["y"] < form["y"], "media panel is not above the form"
    ui_login(page, app_url, OWNER)
    for path in ["/studio", "/studio/projects", "/studio/credits", "/studio/team"]:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        finish_all(page)
        layout(page)
    page.goto(app_url + "/studio")
    prompt = page.get_by_role("textbox", name="Prompt")
    box = prompt.bounding_box()
    assert box and box["width"] >= COMPOSER_MIN_SHARE * PHONE["width"], f"composer is {box} wide"
    page.get_by_role("tab", name="Marketing campaigns", exact=True).click()
    boxes = []
    for title, _ in TEMPLATES:
        b = shown(page.get_by_text(title, exact=True)).bounding_box()
        assert b, title
        boxes.append(b)
    per_row = max(sum(1 for o in boxes if o["y"] < b["y"] + b["height"] and b["y"] < o["y"] + o["height"]) for b in boxes)
    assert per_row <= MAX_CARD_COLUMNS, f"template cards use {per_row} columns"
    page.get_by_role("button", name="Menu", exact=True).click()
    drawer = page.get_by_role("dialog").first
    expect(drawer).to_be_visible()
    for name in ["Projects", "Credits", "Team"]:
        expect(drawer.get_by_role("link", name=name, exact=True)).to_be_attached()


def test_reduced_motion_leaves_nothing_running(browser, app_url):
    acct = signup(app_url, "calm")
    with app_page(browser, app_url + "/", reduced_motion="reduce") as p:
        p.clock.run_for(LOAD_TICK_MS)
        expect(p.get_by_role("heading", level=1)).to_be_visible()
        assert p.evaluate(ENDLESS_JS) == [], "home runs endless animation under reduced motion"
        p.goto(app_url + "/pricing")
        p.clock.run_for(LOAD_TICK_MS)
        expect(p.get_by_role("heading", level=1)).to_be_visible()
        assert p.evaluate(ENDLESS_JS) == [], "pricing runs endless animation under reduced motion"
        ui_login(p, app_url, acct["email"], NEW_PASSWORD)
        prompt = f"Still water at first light {acct['tag']}"
        r = start(app_url, acct["token"], gen_body(acct["project"], prompt=prompt))
        assert r.status_code == 201, r.text
        p.goto(app_url + f"/studio/projects/{acct['project']}")
        end = time.monotonic() + UI_TIMEOUT_MS / 1000
        while not visible_items(p.get_by_text(prompt)) and time.monotonic() < end:
            p.clock.run_for(TICK_MS)
            pause(POLL_INTERVAL_S)
        expect(shown(p.get_by_text(prompt))).to_be_visible(timeout=UI_TIMEOUT_MS)
        p.clock.run_for(TICK_MS)
        running = p.evaluate(ENDLESS_JS)
        status = http("GET", app_url, f"/api/generations/{r.json()['id']}", acct["token"]).json()["status"]
        assert status in {"queued", "rendering"}, "generation finished before the check"
        assert running == [], f"endless animation {running} on a rendering project under reduced motion"


def test_only_session_cookie_and_no_outside_requests(page, app_url):
    live(page)
    outside: list[str] = []

    def watch(req):
        if not req.url.startswith(("data:", "blob:", "about:")) and not same_origin(req.url, app_url):
            outside.append(req.url)

    page.on("request", watch)
    file_inputs = "() => Array.from(document.getElementsByTagName('input')).filter((i) => i.type === 'file').length"
    for path in PUBLIC_PATHS:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        expect(page.get_by_role("button", name=re.compile(r"accept|cookie", re.I))).to_have_count(0)
        assert page.evaluate(file_inputs) == 0, f"{path} shows an upload control"
    ui_login(page, app_url, OWNER)
    for path in ["/studio", "/studio/projects", "/studio/credits", "/studio/team"]:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        assert page.evaluate(file_inputs) == 0, f"{path} shows an upload control"
    assert not outside, f"requests left the app origin: {outside[:5]}"
    assert len(page.context.cookies()) <= 1, page.context.cookies()


OUT_OF_SCOPE = [
    ("POST", "/api/checkout"), ("POST", "/api/billing/checkout"), ("POST", "/api/payments"),
    ("POST", "/api/plan"), ("PATCH", "/api/workspace"), ("POST", "/api/workspace/plan"),
    ("POST", "/api/credits"), ("POST", "/api/credits/top-up"), ("POST", "/api/credits/topup"),
    ("POST", "/api/auth/reset-password"), ("POST", "/api/auth/forgot-password"), ("GET", "/api/auth/google"),
    ("POST", "/api/auth/oauth"), ("POST", "/api/uploads"), ("POST", "/api/upload"), ("POST", "/api/comments"),
    ("DELETE", "/api/me"), ("DELETE", "/api/account"), ("DELETE", "/api/users/me"),
]
OUT_OF_SCOPE_PAGES = ["/checkout", "/billing", "/reset-password", "/forgot-password", "/upload"]


def test_no_payment_plan_change_reset_or_upload_routes(app_url):
    acct = signup(app_url, "scope")
    before = me(app_url, acct["token"])
    sum_before = ws_sum(acct["workspace"])
    claim = {"plan": "max", "credits": 9500, "amount": 9500, "email": acct["email"], "password": NEW_PASSWORD}
    for method, path in OUT_OF_SCOPE:
        r = http(method, app_url, path, acct["token"], claim)
        assert r.is_client_error, f"{method} {path} answered {r.status_code}"
    for path in OUT_OF_SCOPE_PAGES:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    after = me(app_url, acct["token"])
    assert after["workspace"]["plan"] == "free" and after["balance"] == before["balance"] == FREE_CREDITS
    assert ws_sum(acct["workspace"]) == sum_before
    assert login(app_url, acct["email"], NEW_PASSWORD)


def test_home_hero_settles_and_partner_strip_glides(page, app_url):
    record(page)
    page.goto(app_url + "/")
    page.clock.run_for(LOAD_TICK_MS)
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    found = motion(page)
    height = (page.viewport_size or DESKTOP)["height"]

    def settle_ratio(m: dict) -> float:
        first, last = m["samples"][0], m["samples"][-1]
        if first["width"] and last["width"]:
            return first["width"] / last["width"]
        if not m["pseudo"]:
            return 0.0
        size = lambda s: s["a"] * (float(s["scale"].split()[0]) if s.get("scale") not in (None, "", "none") else 1.0)
        return size(first) / size(last) if size(last) else 0.0

    heroes = [m for m in found if m["iterations"] != -1 and 1 < settle_ratio(m) <= HERO_MAX_SCALE
              and (m["samples"][-1]["top"] is None or m["samples"][-1]["top"] < height)]
    assert heroes, "no hero element settles from slightly enlarged to its size"
    strips = [m for m in found if m["iterations"] == -1 and MARQUEE_MIN_MS <= m["duration"] <= MARQUEE_MAX_MS
              and (spread(m, "left") > 1 or spread(m, "e") > 1 or varies_str(m, "translate"))]
    assert strips, "no endless sideways glide of about half a minute"
    assert any(m["faded"] for m in strips), "partner strip edges are not faded"


def test_header_menu_fades_in(page, app_url):
    record(page)
    page.goto(app_url + "/")
    page.clock.run_for(LOAD_TICK_MS)
    page.evaluate(RESET_MOTION_JS)
    page.get_by_role("button", name="Creative", exact=True).click()
    page.clock.run_for(TICK_MS)
    links = header_items(page, "link", "Use Cases")
    assert links, "Creative panel shows no Use Cases link"
    fades = [m for m in motion(page, links[0].element_handle())
             if m["iterations"] != -1 and m["samples"][0]["opacity"] < m["samples"][-1]["opacity"]]
    assert fades, "the menu panel does not fade in"
    assert min(m["duration"] + m["delay"] for m in fades) <= MENU_FADE_MAX_MS


def test_pricing_prices_cross_fade(page, app_url):
    record(page)
    page.goto(app_url + "/pricing")
    page.clock.run_for(LOAD_TICK_MS)
    page.evaluate(RESET_MOTION_JS)
    page.get_by_role("switch", name="Yearly billing").click()
    page.clock.run_for(TICK_MS)
    fades = [m for m in motion(page) if m["iterations"] != -1 and spread(m, "opacity") > 0.2
             and re.search(r"\$|(?<![\d,.])(?:0|12|15|28|35|76|95)(?![\d,.])", m["text"])]
    assert fades, "prices change without a cross-fade"


def test_dialog_opens_with_soft_zoom_over_dimmed_page(page, app_url):
    record(page)
    ui_login(page, app_url, OWNER)
    page.goto(app_url + "/studio/projects")
    credits_link = page.get_by_role("link", name="Credits", exact=True).first
    expect(credits_link).to_be_visible()
    finish_all(page)
    before = decode(capture(credits_link))
    page.evaluate(RESET_MOTION_JS)
    page.get_by_role("button", name="New project", exact=True).first.click()
    page.clock.run_for(TICK_MS)
    dialog = page.get_by_role("dialog", name="New project")
    expect(dialog).to_be_visible()
    related = motion(page, dialog.element_handle())
    zooms = [m for m in related if m["iterations"] != -1 and m["samples"][0]["width"] and m["samples"][-1]["width"]
             and DIALOG_MIN_SCALE <= m["samples"][0]["width"] / m["samples"][-1]["width"] < 1]
    assert zooms, "dialog does not open from a slightly smaller scale"
    assert any(m["samples"][0]["opacity"] < m["samples"][-1]["opacity"] for m in related), "dialog does not fade in"
    finish_all(page)
    changed(before, decode(capture(credits_link)))


def test_cancel_toast_rises_and_leaves(page, app_url):
    acct = signup(app_url, "toast")
    prompt = f"Kites over a grey pier {acct['tag']}"
    record(page)
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    assert start(app_url, acct["token"], gen_body(acct["project"], prompt=prompt)).status_code == 201
    page.goto(app_url + f"/studio/projects/{acct['project']}")
    cancel = scoped(page, "button", "Cancel", prompt)
    page.evaluate(RESET_MOTION_JS)
    cancel.click()
    note = f"Cancelled. {TURBO_PER_S * SHORT_S} credits returned."
    toast = shown(page.get_by_text(note))
    expect(toast).to_be_visible(timeout=UI_TIMEOUT_MS)
    page.clock.run_for(TICK_MS)
    related = motion(page, toast.element_handle())
    assert any(m["samples"][0]["top"] is not None and m["samples"][0]["top"] > m["samples"][-1]["top"] for m in related), \
        "toast does not rise"
    assert any(m["samples"][0]["opacity"] < m["samples"][-1]["opacity"] for m in related), "toast does not fade in"
    until(page, """(t) => !Array.from(document.querySelectorAll('body *')).some((e) => {
      if (!(e.textContent || '').includes(t) || Array.from(e.children).some((c) => (c.textContent || '').includes(t))) return false;
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
    })""", note, seconds=30)


def test_cards_lift_when_pointed_at(page, app_url):
    live(page)
    ui_login(page, app_url, OWNER)
    for path, label in [("/studio/projects", "Spring campaign"), ("/studio", TEMPLATES[0][0])]:
        page.goto(app_url + path)
        if path == "/studio":
            page.get_by_role("tab", name="Marketing campaigns").click()
        card = shown(page.get_by_text(label, exact=True))
        expect(card).to_be_visible()
        card.scroll_into_view_if_needed()
        page.mouse.move(0, 0)
        finish_all(page)
        rest = card.bounding_box()
        if rest:
            page.mouse.move(rest["x"] + rest["width"] / 2, rest["y"] + rest["height"] / 2)
        finish_all(page)
        lifted = card.bounding_box()
        assert rest and lifted and lifted["y"] < rest["y"] - 0.5, f"{label} card does not lift: {rest} -> {lifted}"


def test_phone_drawer_slides_in_from_the_left(page, app_url):
    page.set_viewport_size(PHONE)
    record(page)
    ui_login(page, app_url, OWNER)
    expect(page.get_by_role("heading").first).to_be_visible()
    page.evaluate(RESET_MOTION_JS)
    page.get_by_role("button", name="Menu", exact=True).click()
    page.clock.run_for(TICK_MS)
    drawer = page.get_by_role("dialog").first
    expect(drawer).to_be_visible()
    slides = [m for m in motion(page, drawer.element_handle())
              if m["samples"][0]["left"] is not None and m["samples"][0]["left"] < m["samples"][-1]["left"] - 1]
    assert slides, "drawer does not slide in from the left"
    assert any(m["samples"][0]["opacity"] < m["samples"][-1]["opacity"] for m in motion(page)), "no overlay fades in"


def test_saving_generate_is_unavailable_with_a_spinner(page, app_url):
    acct = signup(app_url, "spinner")
    record(page)
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.get_by_role("textbox", name="Prompt").fill(f"Lanterns on a canal {acct['tag']}")
    generate = page.get_by_role("button", name="Generate", exact=True)
    with hold(page, "**/api/generations") as gate:
        generate.click()
        expect(generate).to_be_disabled()
        page.clock.run_for(TICK_MS)
        spins = [m for m in motion(page, generate.element_handle()) if m["iterations"] == -1
                 and (spread(m, "a") > 0.01 or spread(m, "b") > 0.01 or varies_str(m, "rotate"))]
        assert spins, "no turning spinner on the saving Generate"
        release(gate)
    expect(generate).to_be_enabled(timeout=UI_TIMEOUT_MS)
    assert ws_count("generations", acct["workspace"]) == 1


def test_rendering_card_bar_fills_and_placeholder_breathes(page, app_url):
    acct = signup(app_url, "breathe")
    prompt = f"Fog rolling over pines {acct['tag']}"
    record(page)
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    assert start(app_url, acct["token"], gen_body(acct["project"], prompt=prompt)).status_code == 201
    page.goto(app_url + f"/studio/projects/{acct['project']}")
    cancel = scoped(page, "button", "Cancel", prompt)
    page.clock.run_for(TICK_MS)
    handle = cancel.element_handle()
    card = page.evaluate_handle(
        "([btn, text]) => { let el = btn; while (el && !(el.textContent || '').includes(text)) el = el.parentElement; return el; }",
        [handle, prompt])
    found = motion(page, card.as_element())
    inside = page.evaluate(
        "(card) => (window.__motion || []).filter((a) => a.effect && a.effect.target && card.contains(a.effect.target)).length",
        card)
    assert inside, "the rendering card has no motion"
    endless = [m for m in found if m["iterations"] == -1]
    breath = [m for m in endless if spread(m, "opacity") > 0.02 or spread(m, "a") > 0.005 or varies_str(m, "scale")]
    if not breath:
        breath = page.evaluate(
            "(card) => card.getAnimations({ subtree: true }).filter((a) => a.effect && !Number.isFinite(a.effect.getComputedTiming().iterations))"
            ".some((a) => { const k = a.effect.getKeyframes(); return ['filter', 'backgroundColor'].some((p) => {"
            " const v = k.map((f) => f[p]).filter((x) => x !== undefined); return v.length && (new Set(v).size > 1 || v.length < k.length); }); })",
            card)
    sweep = [m for m in endless if spread(m, "e") > 1 or spread(m, "left") > 1 or varies_str(m, "translate") or varies_str(m, "bg")]
    assert breath, "placeholder does not breathe"
    assert sweep, "no light sweep passes over the placeholder"
    fills = [m for m in found if (m["samples"][-1]["cssWidth"] > m["samples"][0]["cssWidth"] + 1)
             or (m["samples"][-1]["a"] > m["samples"][0]["a"] + 0.05)
             or ((m["samples"][-1]["width"] or 0) > (m["samples"][0]["width"] or 0) + 1)]
    if not fills:
        page.evaluate(
            "(card) => { window.__bar = Array.from(card.querySelectorAll('*')).filter((e) => e.getAttribute('role') === 'progressbar' || !(e.textContent || '').trim()).map((e) => {"
            " const t = getComputedStyle(e).transform; return [e, e.offsetWidth, t && t !== 'none' ? new DOMMatrix(t).a : 1,"
            " parseFloat(e.getAttribute('aria-valuenow') || 'NaN')]; }); }",
            card)
        until(page, "() => (window.__bar || []).some(([e, w, a, v]) => { if (!e.isConnected) return false;"
              " const endless = e.getAnimations().some((x) => !Number.isFinite(x.effect.getComputedTiming().iterations));"
              " const t = getComputedStyle(e).transform; const now = t && t !== 'none' ? new DOMMatrix(t).a : 1;"
              " return parseFloat(e.getAttribute('aria-valuenow') || 'NaN') > v || (!endless && (e.offsetWidth > w + 1 || now > a + 0.05)); })",
              None, seconds=30)


def test_new_card_lands_with_springy_overshoot_and_picture_fades_in(page, app_url):
    acct = signup(app_url, "spring")
    prompt = f"Copper leaves in a slow wind {acct['tag']}"
    record(page)
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.get_by_role("radio", name="Vela Image 4", exact=True).click()
    page.get_by_role("textbox", name="Prompt").fill(prompt)
    page.evaluate(RESET_MOTION_JS)
    page.get_by_role("button", name="Generate", exact=True).click()
    card_text = shown(page.get_by_text(prompt, exact=True))
    expect(card_text).to_be_visible(timeout=UI_TIMEOUT_MS)
    page.clock.run_for(TICK_MS)
    overshoot = False
    for m in motion(page, card_text.element_handle(), points=24):
        if m["iterations"] == -1:
            continue
        for key in ("top", "left", "width", "height"):
            vals = [s[key] for s in m["samples"] if s[key] is not None]
            if len(vals) < 3:
                continue
            first, last = vals[0], vals[-1]
            if abs(first - last) > 0.5 and any((v - last) * (first - last) < 0 and abs(v - last) > 0.3 for v in vals):
                overshoot = True
    assert overshoot, "the new card lands without a springy overshoot"
    page.evaluate(RESET_MOTION_JS)
    gen_id = q(f"SELECT id FROM generations WHERE workspace_id = {lit(acct['workspace'])} AND prompt = {lit(prompt)}")[0]["id"]
    wait_status(app_url, acct["token"], gen_id, {"ready"})
    pictures = page.get_by_role("img", name=prompt, exact=True)
    end = time.monotonic() + 60
    while not visible_items(pictures):
        assert time.monotonic() < end, "the Ready picture never shows with the prompt as its alternative text"
        page.clock.run_for(48)
    until(page, "(p) => Array.from(document.images).filter((i) => i.alt === p).every((i) => i.complete)", prompt, seconds=60)
    picture = shown(pictures)
    expect(picture).to_be_visible()
    fades = [m for m in motion(page, picture.element_handle()) if m["iterations"] != -1
             and m["samples"][0]["opacity"] < m["samples"][-1]["opacity"]]
    assert fades, "the finished picture does not fade in"


def test_header_menus_open_close_and_link(page, app_url):
    live(page)
    page.goto(app_url + "/")
    see(page, "Enterprises get 2 months of usage free. Sign by 10/31.")
    assert path_of(app_url, page.get_by_role("link", name="See terms").first.get_attribute("href")) == "/team-plan"
    assert path_of(app_url, page.get_by_role("link", name="Contact sales").first.get_attribute("href")) == "/enterprise-contact"
    assert path_of(app_url, page.get_by_role("link", name="Kinora", exact=True).first.get_attribute("href")) == "/"
    menus = {
        "Creative": [("Overview", "/product"), ("Use Cases", "/use-cases"), ("Examples", "/examples"),
                     ("Pricing", "/pricing"), ("Team Plan", "/team-plan"), ("Login", "/login")],
        "Research": [("Research Hub", "/research")],
        "Resources": [("Resource Hub", "/resources"), ("Workflows", "/workflows")],
        "Enterprise": [("Overview", "/enterprise"), ("Contact Sales", "/enterprise-contact"),
                       ("Model Licensing", "/model-licensing")],
    }
    probes = {"Creative": "Use Cases", "Research": "Research Hub", "Resources": "Resource Hub",
              "Enterprise": "Model Licensing"}

    def menu_is(menu: str, want: bool) -> None:
        button = page.get_by_role("button", name=menu, exact=True).first
        end = time.monotonic() + UI_TIMEOUT_MS / 1000
        while True:
            flag = button.get_attribute("aria-expanded")
            state = flag == "true" if flag is not None else any(
                link.is_visible() for link in header_items(page, "link", probes[menu]))
            if state == want:
                return
            assert time.monotonic() < end, f"{menu} menu did not {'open' if want else 'close'}"
            pause(POLL_INTERVAL_S)

    for menu, items in menus.items():
        button = page.get_by_role("button", name=menu, exact=True).first
        button.click()
        menu_is(menu, True)
        for name, path in items:
            hrefs = {path_of(app_url, link.get_attribute("href")) for link in header_items(page, "link", name)}
            assert path in hrefs, f"{menu} menu lacks {name} -> {path}"
        button.click()
        menu_is(menu, False)
    creative = page.get_by_role("button", name="Creative", exact=True).first
    research = page.get_by_role("button", name="Research", exact=True).first
    creative.focus()
    page.keyboard.press("Enter")
    menu_is("Creative", True)
    page.keyboard.press("Escape")
    menu_is("Creative", False)
    assert creative.evaluate("(el) => el === document.activeElement"), "Escape did not return focus to the menu button"
    creative.click()
    research.click()
    menu_is("Creative", False)
    menu_is("Research", True)
    page.get_by_role("heading", level=1).click()
    menu_is("Research", False)
    assert path_of(app_url, page.get_by_role("link", name="Pricing", exact=True).first.get_attribute("href")) == "/pricing"
    for name, path in [("Enterprise Sales", "/enterprise-contact"), ("Login", "/login"), ("Try Kinora", "/signup")]:
        page.goto(app_url + "/")
        links = header_items(page, "link", name)
        target = links[0] if links else header_items(page, "button", name)[0]
        target.click()
        expect(page).to_have_url(re.compile(re.escape(path) + r"/?$"))
    page.goto(app_url + "/")
    page.evaluate("() => window.scrollTo(0, 2400)")
    mark = page.get_by_role("link", name="Kinora", exact=True).first.bounding_box()
    assert mark and 0 <= mark["y"] and mark["y"] + mark["height"] <= DESKTOP["height"], "header does not stick"
    for heading in ["Creative", "Research", "Resources", "Company"]:
        expect(page.get_by_text(heading, exact=True).last).to_be_attached()
    assert path_of(app_url, page.get_by_role("link", name="Privacy Policy").first.get_attribute("href")) == "/privacy"
    expect(page.get_by_text("©2026 Kinora AI, Inc.").first).to_be_attached()


def test_home_tabs_and_team_plan_questions_toggle(page, app_url):
    live(page)
    page.goto(app_url + "/")
    names = ["How Kinora is Used", "Create with Agent", "Build your own Workflows", "Enterprise-grade",
             "The World's Best Models"]
    first = page.get_by_role("tab", name=names[0])
    second = page.get_by_role("tab", name=names[1])
    panel_before = shown(page.get_by_role("tabpanel")).inner_text()
    second.click()
    expect(second).to_have_attribute("aria-selected", "true")
    expect(first).to_have_attribute("aria-selected", "false")
    panel_changes(page, panel_before)
    chosen, dimmed = style(second, "opacity", "color"), style(first, "opacity", "color")
    assert chosen != dimmed, "unchosen tabs are not dimmed"
    second.focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("tab", name=names[2])).to_have_attribute("aria-selected", "true")
    page.goto(app_url + "/product")
    moods = page.get_by_role("tab", name="Mood Boards")
    product_before = shown(page.get_by_role("tabpanel")).inner_text()
    moods.click()
    expect(moods).to_have_attribute("aria-selected", "true")
    panel_changes(page, product_before)
    page.goto(app_url + "/team-plan")
    answer = "Team is a plan for groups of two to nine people who create together in one Kinora workspace."
    question = shown(page.get_by_text("What is the Team plan?"))
    if visible_items(page.get_by_text(answer)):
        question.click()
        none_visible(page.get_by_text(answer))
    question.click()
    see(page, answer)
    question.click()
    none_visible(page.get_by_text(answer))
    page.goto(app_url + "/model-licensing")
    link_or_button(page, "Talk to our team").first.click()
    expect(page).to_have_url(re.compile(r"/enterprise-contact/?$"))
    for path in ["/research", "/resources"]:
        page.goto(app_url + path)
        expect(page.get_by_role("heading").first).to_be_visible()
        linked = page.evaluate(
            "() => Array.from(document.querySelectorAll('h2, h3')).filter((h) => { for (let p = h; p; p = p.parentElement) if (p.tagName === 'A') return true; return false; }).length")
        assert linked == 0, f"{path} cards are links"


def test_pricing_tabs_and_billing_switch_change_prices(page, app_url):
    live(page)
    page.goto(app_url + "/pricing")
    switch = page.get_by_role("switch", name="Yearly billing")
    expect(page.get_by_role("tab", name="Individual", exact=True)).to_have_attribute("aria-selected", "true")
    expect(switch).to_be_checked()
    twelve_re = re.compile(r"\$12(?!\d)")
    twelve = page.get_by_text(twelve_re)
    for words in ["$12", "$28", "$76", "Billed annually. Save $36/year.", "Billed annually. Save $84/year.",
                  "Billed annually. Save $228/year.", "Free forever.", "625 credits /mo", "Popular", "Best value",
                  "Credits roll over 1 mo."]:
        see(page, words)
    assert page.evaluate(STRUCK_JS, "$15"), "$15 is not struck through beside $12"
    switch.click()
    expect(switch).not_to_be_checked()
    see(page, "$15")
    none_visible(twelve)
    none_visible(page.get_by_text("Billed annually. Save $36/year."))
    switch.focus()
    page.keyboard.press("Space")
    expect(switch).to_be_checked()
    see(page, twelve_re)
    page.keyboard.press("Enter")
    expect(switch).not_to_be_checked()
    page.keyboard.press("Enter")
    expect(switch).to_be_checked()
    page.get_by_role("tab", name="Team & Enterprise").click()
    see(page, "Get Team")
    see(page, "Talk to Sales")
    see(page, "$55")
    none_visible(page.get_by_text("Get Standard"))
    page.get_by_role("tab", name="API", exact=True).click()
    see(page, "API access is arranged with our sales team.")
    shown(link_or_button(page, "Contact sales")).click()
    expect(page).to_have_url(re.compile(r"/enterprise-contact/?$"))
    page.goto(app_url + "/pricing")
    shown(link_or_button(page, "Get Pro")).click()
    expect(page).to_have_url(re.compile(r"/enterprise-contact/?$"))
    page.goto(app_url + "/pricing")
    shown(link_or_button(page, "Start Free")).click()
    expect(page).to_have_url(re.compile(r"/signup/?$"))


def test_plans_and_models_catalogue_match_credit_prices(app_url):
    plans = httpx.get(app_url + "/api/plans", timeout=HTTP_TIMEOUT_S)
    assert plans.status_code == 200
    got = plans.json()
    assert [p["id"] for p in got] == [e[0] for e in EXPECTED_PLANS]
    for plan, (pid, name, monthly, yearly, credits, parallel, projects) in zip(got, EXPECTED_PLANS):
        actual = (plan["name"], plan["monthly_price"], plan["yearly_price"], plan["credits"],
                  plan["parallel_limit"], plan["project_limit"])
        assert actual == (name, monthly, yearly, credits, parallel, projects), f"{pid}: {actual}"
        for v in actual[1:]:
            assert v is None or (isinstance(v, int) and not isinstance(v, bool)), f"{pid} has non-integer {v!r}"
    models = httpx.get(app_url + "/api/models", timeout=HTTP_TIMEOUT_S)
    assert models.status_code == 200
    rows = {m["id"]: (m["name"], m["kind"], m["credits_per_unit"]) for m in models.json()}
    assert rows == EXPECTED_MODELS and len(models.json()) == 3


def test_examples_filter_by_category_and_search(app_url):
    def get(**params):
        r = httpx.get(app_url + "/api/examples", params=params, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == len(body["items"])
        return [(i["heading"], i["category"], i["prompt"]) for i in body["items"]]

    assert get() == EXAMPLES
    for category in ["product-ads", "animated-stories", "ugc", "from-a-link"]:
        assert get(category=category) == [e for e in EXAMPLES if e[1] == category]
    term = "COFFEE"
    assert get(search=f"  {term}  ") == [e for e in EXAMPLES if term.lower() in (e[0] + e[2]).lower()]
    assert get(category="ugc", search="chair") == [e for e in EXAMPLES if e[1] == "ugc" and "chair" in e[2]]
    assert get(search="xylophone") == []


def test_examples_tabs_search_copy_and_try_in_studio(page, app_url):
    live(page)
    acct = signup(app_url, "library")
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
    page.goto(app_url + "/examples")
    expect(page.get_by_role("tab", name="All", exact=True)).to_have_attribute("aria-selected", "true")
    see(page, f"{len(EXAMPLES)} examples")
    page.get_by_role("tab", name="UGC", exact=True).click()
    see(page, "2 examples")
    none_visible(page.get_by_text(EXAMPLES[0][0]))
    page.get_by_role("tab", name="All", exact=True).click()
    search = page.get_by_label("Search examples")
    search.fill("coffee")
    see(page, "2 examples")
    search.fill("xylophone")
    see(page, "No examples match xylophone.")
    search.fill("")
    see(page, f"{len(EXAMPLES)} examples")
    page.get_by_role("button", name="Copy prompt").first.click()
    see(page, "Prompt copied")
    assert norm(page.evaluate("() => navigator.clipboard.readText()")) == norm(EXAMPLES[0][2])
    shown(link_or_button(page, "Try in Studio")).click()
    expect(page).to_have_url(re.compile(r"/login"))
    page.get_by_label("Email", exact=True).fill(acct["email"])
    page.get_by_label("Password", exact=True).fill(NEW_PASSWORD)
    page.get_by_role("button", name="Log in").click()
    expect(page).to_have_url(re.compile(r"/studio/?([?#].*)?$"), timeout=UI_TIMEOUT_MS)
    expect(page.get_by_role("textbox", name="Prompt")).to_have_value(EXAMPLES[0][2])


def test_signup_creates_free_workspace_with_credits_and_project(app_url, mail):
    tag, email = fresh("owner")
    name = f"Lena Hart {tag}"[:NAME_MAX]
    r = http("POST", app_url, "/api/auth/signup", body={"name": f"  {name}  ", "email": email, "password": NEW_PASSWORD})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"] and body["user"]["role"] == "owner" and body["user"]["email"].lower() == email.lower()
    profile = me(app_url, body["token"])
    assert profile["workspace"]["plan"] == "free"
    assert profile["workspace"]["name"] == f"{name}'s workspace"
    assert profile["balance"] == FREE_CREDITS
    ws = profile["workspace"]["id"]
    users = q(f"SELECT role, workspace_id FROM users WHERE lower(email) = lower({lit(email)})")
    assert len(users) == 1 and users[0]["role"] == "owner" and str(users[0]["workspace_id"]) == str(ws)
    assert q(f"SELECT plan FROM workspaces WHERE id = {lit(ws)}")[0]["plan"] == "free"
    entries = q(f"SELECT kind, amount, balance_after FROM credit_entries WHERE workspace_id = {lit(ws)}")
    assert entries == [{"kind": "plan", "amount": FREE_CREDITS, "balance_after": FREE_CREDITS}]
    assert [p["name"] for p in q(f"SELECT name FROM projects WHERE workspace_id = {lit(ws)}")] == ["My first project"]
    assert inbox(mail, email, expected=0) == []


def test_signup_duplicate_or_invalid_rejected(app_url, mail):
    acct = signup(app_url, "taken")
    for variant in [acct["email"].upper(), acct["email"].capitalize()]:
        r = http("POST", app_url, "/api/auth/signup", body={"name": "Second", "email": variant, "password": NEW_PASSWORD})
        assert r.status_code == 409, r.text
    assert int(q(f"SELECT COUNT(*) AS n FROM users WHERE lower(email) = lower({lit(acct['email'])})")[0]["n"]) == 1
    _, email = fresh("invalid")
    cases = [
        ({"name": "   ", "email": email, "password": NEW_PASSWORD}, {"name"}),
        ({"name": "x" * (NAME_MAX + 1), "email": email, "password": NEW_PASSWORD}, {"name"}),
        ({"name": "Valid", "email": "not-an-email", "password": NEW_PASSWORD}, {"email"}),
        ({"name": "Valid", "email": email, "password": "short-pw"}, {"password"}),
        ({"name": "", "email": "nope", "password": "x"}, {"name", "email", "password"}),
    ]
    for body, fields in cases:
        r = http("POST", app_url, "/api/auth/signup", body=body)
        assert r.status_code == 422, f"{body}: {r.status_code}"
        assert fields <= set(r.json()["errors"]), r.json()
    assert q(f"SELECT COUNT(*) AS n FROM users WHERE lower(email) = lower({lit(email)})")[0]["n"] == 0
    assert inbox(mail, acct["email"], expected=0) == [] and inbox(mail, email, expected=0) == []


def test_login_returns_token_for_each_seeded_account(app_url):
    for email, name, role, workspace, plan in SEEDED:
        for variant in (email, email.upper()):
            r = http("POST", app_url, "/api/auth/login", body={"email": variant, "password": PASSWORD})
            assert r.status_code == 200, f"{variant}: {r.status_code} {r.text}"
            body = r.json()
            assert body["user"]["name"] == name and body["user"]["role"] == role
            profile = me(app_url, body["token"])
            assert profile["workspace"]["name"] == workspace and profile["workspace"]["plan"] == plan


def test_wrong_credentials_rejected_with_one_message(app_url):
    _, unknown = fresh("nobody")
    bad_pw = http("POST", app_url, "/api/auth/login", body={"email": OWNER, "password": "wrong-password-0"})
    bad_email = http("POST", app_url, "/api/auth/login", body={"email": unknown, "password": PASSWORD})
    for r in (bad_pw, bad_email):
        assert r.status_code == 401
        assert r.json()["error"] == "Email or password is incorrect."
        assert "token" not in r.json()
    assert bad_pw.json() == bad_email.json()


def test_logout_ends_token(app_url):
    token = login(app_url, CREATOR)
    assert http("GET", app_url, "/api/me", token).status_code == 200
    assert http("POST", app_url, "/api/auth/logout", token).status_code == 200
    for method, path in [("GET", "/api/me"), ("GET", "/api/projects"), ("GET", "/api/credits")]:
        assert http(method, app_url, path, token).status_code == 401


def test_signed_out_studio_redirects_to_login(page, app_url):
    live(page)
    for path in ["/studio", "/studio/projects", "/studio/credits", "/studio/team"]:
        page.goto(app_url + path)
        expect(page).to_have_url(re.compile(r"/login/?(\?.*)?$"), timeout=UI_TIMEOUT_MS)
    ui_login(page, app_url, CREATOR)
    for path in ["/login", "/signup"]:
        page.goto(app_url + path)
        expect(page).to_have_url(re.compile(r"/studio/?(\?.*)?$"), timeout=UI_TIMEOUT_MS)


def test_passwords_stored_hashed(app_url):
    acct = signup(app_url, "hashed")
    for email, secret in [(OWNER, PASSWORD), (MEMBER, PASSWORD), (CREATOR, PASSWORD), (acct["email"], NEW_PASSWORD)]:
        rows = q(f"SELECT * FROM users WHERE lower(email) = lower({lit(email)})")
        assert len(rows) == 1
        assert secret not in json.dumps(rows[0], default=str), f"{email} row holds its password"


def test_seed_rows_persisted_in_every_table(app_url, mail):
    for email, name, role, workspace, plan in SEEDED:
        rows = q(f"SELECT u.name, u.role, w.name AS workspace, w.plan FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE lower(u.email) = lower({lit(email)})")
        assert rows == [{"name": name, "role": role, "workspace": workspace, "plan": plan}], email
    ids = seeded_ids()
    for ws, project in [(ids["northlight"], "Spring campaign"), (ids["northlight"], "Brand film"), (ids["ines"], "Music video")]:
        assert ws_count("projects", ws, f"lower(name) = lower({lit(project)})") == 1, project
    expected = [
        (BOAT, "Mara Quinn", "vela-4.5", LONG_S, None, "16:9", 120, "Spring campaign"),
        (MUG, "Theo Park", "vela-image-4", None, 2, "1:1", 16, "Spring campaign"),
        (NEON, "Ines Duarte", "vela-4-turbo", SHORT_S, None, "9:16", 30, "Music video"),
    ]
    for prompt, person, model, duration, count, aspect, cost, project in expected:
        rows = q(f"SELECT u.name AS person, g.model, g.duration, g.image_count, g.aspect, g.cost, g.status, p.name AS project FROM generations g JOIN users u ON u.id = g.user_id JOIN projects p ON p.id = g.project_id WHERE g.prompt = {lit(prompt)}")
        assert rows == [{"person": person, "model": model, "duration": duration, "image_count": count,
                         "aspect": aspect, "cost": cost, "status": "ready", "project": project}], prompt
    nl_rows = q(f"SELECT e.kind, e.amount, e.balance_after, u.name FROM credit_entries e JOIN users u ON u.id = e.user_id WHERE e.workspace_id = {lit(ids['northlight'])} AND (e.generation_id IN ({lit(ids['boat'])}, {lit(ids['mug'])}) OR (e.kind = 'seat' AND lower(u.email) IN ({lit(OWNER)}, {lit(MEMBER)})))")
    assert sorted((r["kind"], r["amount"], r["balance_after"], r["name"]) for r in nl_rows) == sorted([
        ("seat", SEAT_CREDITS, SEAT_CREDITS, "Mara Quinn"), ("seat", SEAT_CREDITS, 2 * SEAT_CREDITS, "Theo Park"),
        ("charge", -120, 2 * SEAT_CREDITS - 120, "Mara Quinn"),
        ("charge", -16, NORTHLIGHT_SEEDED_BALANCE, "Theo Park"),
    ])
    ines_plan = q(f"SELECT amount, balance_after FROM credit_entries WHERE workspace_id = {lit(ids['ines'])} AND kind = 'plan'")
    assert ines_plan == [{"amount": STANDARD_CREDITS, "balance_after": STANDARD_CREDITS}]
    assert entries_for(ids["neon"], "charge") == [{"amount": -30, "balance_after": INES_SEEDED_BALANCE}]
    for gid in (ids["boat"], ids["mug"], ids["neon"]):
        assert entries_for(gid, "refund") == []
    mara, ines = login(app_url, OWNER), login(app_url, CREATOR)
    for token, gid in [(mara, ids["boat"]), (mara, ids["mug"]), (ines, ids["neon"])]:
        r = output(app_url, token, gid)
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    for email, *_ in SEEDED:
        assert inbox(mail, email, expected=0) == [], f"seed sent email to {email}"


def test_studio_endpoints_denied_without_token(app_url):
    ids = seeded_ids()
    mara = login(app_url, OWNER)
    mara_id = member_id(app_url, mara, OWNER)
    tag, email = fresh("claim")
    probe_name = f"Claimed {tag}"
    claim = {"role": "owner", "workspace_id": ids["northlight"], "user_id": mara_id, "name": probe_name,
             "email": email, "project_id": ids["spring"], "model": "vela-4.5", "prompt": probe_name,
             "duration": SHORT_S, "image_count": None, "aspect": "16:9", "cost": 0}
    endpoints = [
        ("GET", "/api/me"), ("GET", "/api/projects"), ("POST", "/api/projects"), ("PATCH", f"/api/projects/{ids['spring']}"),
        ("GET", f"/api/projects/{ids['spring']}/generations"), ("POST", "/api/generations"),
        ("GET", f"/api/generations/{ids['boat']}"), ("POST", f"/api/generations/{ids['boat']}/cancel"),
        ("GET", f"/api/generations/{ids['boat']}/output"), ("GET", "/api/credits"), ("GET", "/api/team"),
        ("POST", "/api/team/invitations"), ("DELETE", f"/api/team/members/{mara_id}"), ("POST", "/api/auth/logout"),
    ]
    entries_before = ws_count("credit_entries", ids["northlight"])
    junk_headers = [None, "Bearer", "Bearer not-a-real-token", "Basic b3duZXI6cGFzcw==", f"Token {mara}"]
    for header in junk_headers:
        hdrs = {} if header is None else {"Authorization": header}
        for method, path in endpoints:
            r = httpx.request(method, app_url + path, json=claim, headers=hdrs, timeout=HTTP_TIMEOUT_S)
            assert r.status_code == 401, f"{method} {path} with {header!r}: {r.status_code}"
    assert ws_count("projects", ids["northlight"], f"name = {lit(probe_name)}") == 0
    assert q(f"SELECT COUNT(*) AS n FROM invitations WHERE lower(email) = lower({lit(email)})")[0]["n"] == 0
    assert q(f"SELECT name FROM projects WHERE id = {lit(ids['spring'])}")[0]["name"] == "Spring campaign"
    assert q(f"SELECT status FROM generations WHERE id = {lit(ids['boat'])}")[0]["status"] == "ready"
    assert q(f"SELECT removed_at FROM users WHERE id = {lit(mara_id)}")[0]["removed_at"] is None
    assert ws_count("credit_entries", ids["northlight"]) == entries_before
    assert http("GET", app_url, "/api/me", mara).status_code == 200


def test_cross_workspace_project_and_generation_not_found(page, app_url):
    live(page)
    ids = seeded_ids()
    outsider = signup(app_url, "outsider")
    t = outsider["token"]
    balance_before = ws_sum(ids["northlight"])
    checks = [
        ("GET", f"/api/projects/{ids['spring']}/generations", None),
        ("PATCH", f"/api/projects/{ids['spring']}", {"name": f"Taken {outsider['tag']}"}),
        ("GET", f"/api/generations/{ids['boat']}", None),
        ("GET", f"/api/generations/{ids['boat']}/output", None),
        ("POST", f"/api/generations/{ids['boat']}/cancel", None),
        ("GET", f"/api/projects/{unknown_like(ids['spring'])}/generations", None),
        ("GET", f"/api/generations/{unknown_like(ids['boat'])}", None),
    ]
    for method, path, body in checks:
        r = http(method, app_url, path, t, body)
        assert r.status_code == 404, f"{method} {path}: {r.status_code}"
    foreign = f"Foreign {outsider['tag']}"
    r = start(app_url, t, gen_body(ids["spring"], prompt=foreign))
    assert r.status_code in (404, 422), r.status_code
    assert ws_count("generations", ids["northlight"], f"prompt = {lit(foreign)}") == 0
    assert q(f"SELECT name FROM projects WHERE id = {lit(ids['spring'])}")[0]["name"] == "Spring campaign"
    assert q(f"SELECT status FROM generations WHERE id = {lit(ids['boat'])}")[0]["status"] == "ready"
    assert entries_for(ids["boat"], "refund") == []
    assert ws_sum(ids["northlight"]) == balance_before
    assert me(app_url, t)["balance"] == FREE_CREDITS
    names = [p["name"] for p in http("GET", app_url, "/api/projects", t).json()]
    assert "Spring campaign" not in names
    ui_login(page, app_url, outsider["email"], NEW_PASSWORD)
    page.goto(app_url + f"/studio/projects/{ids['spring']}")
    see(page, "That project does not exist.")
    page.goto(app_url + f"/studio/generations/{ids['boat']}")
    see(page, "That generation does not exist.")
    expect(page.get_by_text(BOAT)).to_have_count(0)


def test_project_create_rename_and_duplicate_name_refused(app_url):
    owner = login(app_url, OWNER)
    ws = workspace_id(NORTHLIGHT)
    tag, _ = fresh("proj")
    a, b, c = f"Storyboard {tag}", f"Lookbook {tag}", f"Teaser {tag}"
    ra = http("POST", app_url, "/api/projects", owner, {"name": a})
    rb = http("POST", app_url, "/api/projects", owner, {"name": b})
    assert ra.status_code == 201 and rb.status_code == 201, (ra.text, rb.text)
    pa, pb = ra.json(), rb.json()
    assert pa["name"] == a and pa["generation_count"] == 0 and pa["created_at"]
    listed = [p["id"] for p in http("GET", app_url, "/api/projects", owner).json()]
    assert listed.index(pb["id"]) < listed.index(pa["id"]), "projects are not newest first"
    for dup in (b.upper(), f"  {b.lower()}  "):
        r = http("POST", app_url, "/api/projects", owner, {"name": dup})
        assert r.status_code == 409 and r.json()["error"] == "duplicate_name", r.text
    renamed = f"Moodboard {tag}"
    r = http("PATCH", app_url, f"/api/projects/{pa['id']}", owner, {"name": renamed})
    assert r.status_code == 200 and r.json()["name"] == renamed
    r = http("PATCH", app_url, f"/api/projects/{pa['id']}", owner, {"name": b.lower()})
    assert r.status_code == 409 and r.json()["error"] == "duplicate_name"
    assert q(f"SELECT name FROM projects WHERE id = {lit(pa['id'])}")[0]["name"] == renamed
    for bad in ("   ", "x" * (NAME_MAX + 1)):
        r = http("POST", app_url, "/api/projects", owner, {"name": bad})
        assert r.status_code == 422 and "name" in r.json()["errors"]
    assert ws_count("projects", ws, f"lower(name) = lower({lit(b)})") == 1
    results = together(CONCURRENCY, lambda i: http("POST", app_url, "/api/projects", owner,
                                                   {"name": c if i % 2 else c.upper()}))
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(409) == CONCURRENCY - 1, codes
    assert ws_count("projects", ws, f"lower(name) = lower({lit(c)})") == 1


def test_project_limit_refused_on_free_plan(app_url):
    acct = signup(app_url, "limit")
    r = http("POST", app_url, "/api/projects", acct["token"], {"name": f"Second {acct['tag']}"})
    assert r.status_code == 409, r.text
    assert r.json() == {"error": "project_limit", "limit": FREE_PROJECTS}
    assert ws_count("projects", acct["workspace"]) == FREE_PROJECTS


def test_new_project_dialog_creates_and_refuses_duplicate(page, app_url):
    live(page)
    tag, _ = fresh("dialog")
    name = f"Campaign {tag}"
    ws = workspace_id(NORTHLIGHT)
    ui_login(page, app_url, OWNER)
    page.goto(app_url + "/studio/projects")
    page.get_by_role("button", name="New project", exact=True).first.click()
    dialog = page.get_by_role("dialog", name="New project")
    dialog.get_by_label("Project name").fill(name)
    dialog.get_by_role("button", name="Create").click()
    expect(dialog).to_be_hidden(timeout=UI_TIMEOUT_MS)
    see(page, name)
    assert ws_count("projects", ws, f"name = {lit(name)}") == 1
    page.get_by_role("button", name="New project", exact=True).first.click()
    dialog.get_by_label("Project name").fill(name.upper())
    dialog.get_by_role("button", name="Create").click()
    see(page, "A project with this name already exists.")
    expect(dialog.get_by_label("Project name")).to_have_value(name.upper())
    dialog.get_by_role("button", name="Cancel").click()
    expect(dialog).to_be_hidden()
    assert ws_count("projects", ws, f"lower(name) = lower({lit(name)})") == 1


def test_composer_cost_line_and_template_fill(page, app_url):
    live(page)
    acct = signup(app_url, "composer")
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    expect(page.get_by_role("heading", name="What will you create today?")).to_be_visible()
    prompt = page.get_by_role("textbox", name="Prompt")
    expect(prompt).to_have_attribute("placeholder", "Type your thoughts...")
    expect(page.get_by_role("radio", name="Vela 4.5", exact=True)).to_be_checked()
    expect(page.get_by_role("radio", name="5 seconds")).to_be_checked()
    expect(page.get_by_role("radio", name="16:9")).to_be_checked()
    project = page.get_by_role("combobox", name="Project")
    assert project.evaluate(
        "(s) => (s.options ? s.options[s.selectedIndex].text : ('value' in s && s.value) || s.textContent || '').trim()"
    ) == "My first project"
    see(page, f"This will use {VELA_45_PER_S * SHORT_S} credits")
    page.get_by_role("radio", name="10 seconds").click()
    see(page, f"This will use {VELA_45_PER_S * LONG_S} credits")
    page.get_by_role("radio", name="Vela 4 Turbo", exact=True).click()
    see(page, f"This will use {TURBO_PER_S * LONG_S} credits")
    page.get_by_role("radio", name="Vela Image 4", exact=True).click()
    images = page.get_by_role("spinbutton", name="Images")
    expect(images).to_have_value("1")
    expect(page.get_by_role("radio", name="5 seconds")).to_be_hidden()
    see(page, f"This will use {IMAGE_PER} credits")
    images.fill("3")
    see(page, f"This will use {IMAGE_PER * 3} credits")
    for tab in ["Marketing campaigns", "Movies", "Social media", "Educational content", "Experimental art", "Other"]:
        expect(page.get_by_role("tab", name=tab)).to_be_attached()
    page.get_by_role("tab", name="Marketing campaigns").click()
    title, starter = TEMPLATES[1]
    shown(page.get_by_text(title, exact=True)).click()
    try:
        expect(prompt).to_have_value(starter, timeout=3000)
    except AssertionError:
        scoped(page, "button", "Try", title).click()
    expect(prompt).to_have_value(starter)
    see(page, "Recent generations")
    prompt.fill("")
    page.get_by_role("button", name="Generate", exact=True).click()
    see(page, "Write a prompt first.")
    assert ws_count("generations", acct["workspace"]) == 0
    assert ws_sum(acct["workspace"]) == FREE_CREDITS


def test_generation_charge_persisted_with_server_cost(app_url):
    acct = signup(app_url, "charge")
    t = acct["token"]
    body = gen_body(acct["project"], "vela-image-4", f"Glass orchard {acct['tag']}", image_count=2, aspect="1:1")
    body["cost"] = 1
    r = start(app_url, t, body)
    assert r.status_code == 201, r.text
    g = r.json()
    assert (g["cost"], g["status"], g["duration"], g["image_count"], g["aspect"], g["started_by"]) == \
        (IMAGE_PER * 2, "queued", None, 2, "1:1", acct["name"])
    assert me(app_url, t)["balance"] == FREE_CREDITS - IMAGE_PER * 2
    assert entries_for(g["id"], "charge") == [{"amount": -IMAGE_PER * 2, "balance_after": FREE_CREDITS - IMAGE_PER * 2}]
    v = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", f"Glass river {acct['tag']}", duration=LONG_S))
    assert v.status_code == 201 and v.json()["cost"] == TURBO_PER_S * LONG_S
    assert q(f"SELECT cost FROM generations WHERE id = {lit(v.json()['id'])}")[0]["cost"] == TURBO_PER_S * LONG_S
    assert ws_sum(acct["workspace"]) == FREE_CREDITS - IMAGE_PER * 2 - TURBO_PER_S * LONG_S
    owner, theo = login(app_url, OWNER), login(app_url, MEMBER)
    ids = seeded_ids()
    shared_before = me(app_url, owner)["balance"]
    s = start(app_url, theo, gen_body(ids["spring"], "vela-image-4", f"Shared pool {acct['tag']}", image_count=1))
    assert s.status_code == 201, s.text
    assert me(app_url, owner)["balance"] == shared_before - IMAGE_PER, "Theo's start did not lower the shared balance"
    assert len(entries_for(s.json()["id"], "charge")) == 1


def test_generation_invalid_fields_rejected(app_url):
    acct = signup(app_url, "invalidgen")
    t, pid = acct["token"], acct["project"]
    cases = [
        ({"model": "vela-9"}, {"model"}),
        ({"duration": 7}, {"duration"}),
        ({"aspect": "4:3"}, {"aspect"}),
        ({"prompt": "   "}, {"prompt"}),
        ({"prompt": "x" * (PROMPT_MAX + 1)}, {"prompt"}),
        ({"model": "vela-image-4", "duration": None, "image_count": 5}, {"image_count"}),
        ({"model": "vela-image-4", "duration": None, "image_count": 0}, {"image_count"}),
        ({"prompt": "", "aspect": "2:1", "duration": 3}, {"prompt", "aspect", "duration"}),
    ]
    for over, fields in cases:
        body = gen_body(pid, "vela-4.5", f"Valid prompt {acct['tag']}")
        body.update(over)
        r = start(app_url, t, body, idempotency_key())
        assert r.status_code == 422, f"{over}: {r.status_code}"
        assert fields <= set(r.json()["errors"]), r.json()
    assert ws_count("generations", acct["workspace"]) == 0
    assert ws_sum(acct["workspace"]) == FREE_CREDITS == me(app_url, t)["balance"]


def test_signup_journey_lands_in_studio_with_balance(page, app_url):
    live(page)
    _, email = fresh("lena")
    page.goto(app_url + "/pricing")
    switch = page.get_by_role("switch", name="Yearly billing")
    switch.click()
    see(page, "$15")
    switch.click()
    see(page, "$12")
    shown(link_or_button(page, "Start Free")).click()
    expect(page).to_have_url(re.compile(r"/signup/?$"))
    ui_signup(page, "Lena Hart", email)
    expect(page).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)
    see(page, amount_re(FREE_CREDITS))
    page.get_by_role("textbox", name="Prompt").fill(LANTERN)
    page.get_by_role("radio", name="Vela 4.5", exact=True).click()
    page.get_by_role("radio", name="10 seconds").click()
    see(page, f"This will use {VELA_45_PER_S * LONG_S} credits")
    page.get_by_role("button", name="Generate", exact=True).click()
    see(page, re.compile(r"\b(Queued|Rendering)\b"))
    see(page, amount_re(FREE_CREDITS - VELA_45_PER_S * LONG_S))
    expect(shown(page.get_by_role("img", name=LANTERN))).to_be_visible(timeout=READY_UI_TIMEOUT_MS)
    page.get_by_role("radio", name="Vela 4 Turbo", exact=True).click()
    page.get_by_role("radio", name="5 seconds").click()
    page.get_by_role("textbox", name="Prompt").fill(LANTERN)
    page.get_by_role("button", name="Generate", exact=True).click()
    see(page, f"Not enough credits. This needs {TURBO_PER_S * SHORT_S} and you have {FREE_CREDITS - VELA_45_PER_S * LONG_S}.")
    ws = q(f"SELECT workspace_id FROM users WHERE lower(email) = lower({lit(email)})")[0]["workspace_id"]
    gens = q(f"SELECT status, cost FROM generations WHERE workspace_id = {lit(ws)}")
    assert gens == [{"status": "ready", "cost": VELA_45_PER_S * LONG_S}]
    assert ws_sum(ws) == FREE_CREDITS - VELA_45_PER_S * LONG_S


def test_insufficient_credits_refused_and_nothing_charged(app_url):
    acct = signup(app_url, "short")
    t = acct["token"]
    assert start(app_url, t, gen_body(acct["project"], "vela-4.5", f"Big one {acct['tag']}", duration=LONG_S)).status_code == 201
    left = FREE_CREDITS - VELA_45_PER_S * LONG_S
    r = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", f"Too much {acct['tag']}"))
    assert r.status_code == 402, r.text
    assert r.json() == {"error": "insufficient_credits", "needed": TURBO_PER_S * SHORT_S, "balance": left}
    assert ws_count("generations", acct["workspace"]) == 1
    assert ws_count("credit_entries", acct["workspace"], "kind = 'charge'") == 1
    assert ws_sum(acct["workspace"]) == left == me(app_url, t)["balance"]


def test_parallel_limit_refused_and_nothing_charged(app_url):
    acct = signup(app_url, "parallel")
    t = acct["token"]
    for i in range(FREE_PARALLEL):
        assert start(app_url, t, gen_body(acct["project"], prompt=f"Lane {i} {acct['tag']}")).status_code == 201
    left = FREE_CREDITS - FREE_PARALLEL * TURBO_PER_S * SHORT_S
    r = start(app_url, t, gen_body(acct["project"], prompt=f"Third lane {acct['tag']}"))
    assert r.status_code == 409, r.text
    assert r.json() == {"error": "parallel_limit", "limit": FREE_PARALLEL}
    both = start(app_url, t, gen_body(acct["project"], "vela-4.5", f"Both {acct['tag']}", duration=LONG_S))
    assert both.status_code == 402 and both.json()["error"] == "insufficient_credits"
    assert ws_count("generations", acct["workspace"]) == FREE_PARALLEL
    assert ws_sum(acct["workspace"]) == left == me(app_url, t)["balance"]


def test_idempotent_key_repeat_charges_once(app_url):
    acct = signup(app_url, "repeat")
    key = idempotency_key()
    body = gen_body(acct["project"], "vela-image-4", f"Paper cranes {acct['tag']}")
    first = start(app_url, acct["token"], body, key)
    assert first.status_code == 201, first.text
    for _ in range(2):
        again = start(app_url, acct["token"], body, key)
        assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert ws_count("generations", acct["workspace"], f"idempotency_key = {lit(key)}") == 1
    assert ws_count("credit_entries", acct["workspace"], "kind = 'charge'") == 1
    other = start(app_url, acct["token"], body, idempotency_key())
    assert other.status_code == 201 and other.json()["id"] != first.json()["id"]
    assert ws_sum(acct["workspace"]) == FREE_CREDITS - 2 * IMAGE_PER


def test_concurrent_duplicate_key_charges_once(app_url):
    acct = signup(app_url, "samekey")
    key = idempotency_key()
    body = gen_body(acct["project"], "vela-4-turbo", f"Twin lanterns {acct['tag']}")
    results = together(CONCURRENCY, lambda i: start(app_url, acct["token"], body, key))
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(200) == CONCURRENCY - 1, codes
    assert len({r.json()["id"] for r in results}) == 1
    assert ws_count("generations", acct["workspace"]) == 1
    assert ws_count("credit_entries", acct["workspace"], "kind = 'charge'") == 1
    assert ws_sum(acct["workspace"]) == FREE_CREDITS - TURBO_PER_S * SHORT_S


def test_concurrent_starts_beyond_balance_leave_one(app_url):
    acct = signup(app_url, "race")
    results = together(CONCURRENCY, lambda i: start(
        app_url, acct["token"], gen_body(acct["project"], "vela-4.5", f"Race {i} {acct['tag']}", duration=LONG_S),
        idempotency_key()))
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(402) == CONCURRENCY - 1, codes
    assert ws_count("generations", acct["workspace"]) == 1
    assert ws_count("credit_entries", acct["workspace"], "kind = 'charge'") == 1
    assert ws_sum(acct["workspace"]) == FREE_CREDITS - VELA_45_PER_S * LONG_S
    assert int(q(f"SELECT MIN(balance_after) AS low FROM credit_entries WHERE workspace_id = {lit(acct['workspace'])}")[0]["low"]) >= 0


def test_double_click_generate_starts_one_generation(page, app_url):
    acct = signup(app_url, "dbl")
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    prompt = f"Two clicks one kite {acct['tag']}"
    page.get_by_role("radio", name="Vela Image 4", exact=True).click()
    page.get_by_role("textbox", name="Prompt").fill(prompt)
    page.get_by_role("button", name="Generate", exact=True).dblclick()
    expect(shown(page.get_by_text(prompt, exact=True))).to_be_visible(timeout=UI_TIMEOUT_MS)
    page.wait_for_load_state("networkidle")
    assert ws_count("generations", acct["workspace"]) == 1
    assert ws_count("credit_entries", acct["workspace"], "kind = 'charge'") == 1


def test_generation_renders_to_ready_within_window_with_output(app_url):
    acct = signup(app_url, "render")
    outsider = signup(app_url, "peek")
    t = acct["token"]
    prompt = f"Amber dunes under a slow violet sky {acct['tag']}"
    sent = time.monotonic()
    a = start(app_url, t, gen_body(acct["project"], "vela-image-4", prompt, aspect="16:9"))
    posted = time.monotonic()
    assert a.status_code == 201 and a.json()["status"] == "queued"
    b = start(app_url, t, gen_body(acct["project"], "vela-image-4", prompt, aspect="16:9"))
    assert b.status_code == 201
    ga, gb = a.json()["id"], b.json()["id"]
    assert output(app_url, t, ga).status_code == 409, "output served before Ready"
    assert output(app_url, outsider["token"], ga).status_code == 404
    while True:
        asked = time.monotonic()
        r = http("GET", app_url, f"/api/generations/{ga}", t)
        answered = time.monotonic()
        status = r.json()["status"]
        if status == "ready":
            assert answered - sent >= RENDER_MIN_S, f"Ready after {answered - sent:.1f} s"
            break
        assert status in {"queued", "rendering"}, status
        assert asked - posted <= RENDER_MAX_S + TIMING_SLACK_S, "not Ready within the window"
        pause(POLL_INTERVAL_S)
    done = r.json()
    def when(v):
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc)
        return iso(v)
    span = (when(done["finished_at"]) - when(done["created_at"])).total_seconds()
    assert RENDER_MIN_S <= span <= RENDER_MAX_S + 1, f"server span {span}"
    wait_status(app_url, t, gb, {"ready"})
    first = output(app_url, t, ga)
    assert first.status_code == 200 and first.headers["content-type"].startswith("image/svg+xml")
    svg = first.text
    assert prompt in html.unescape(svg), "output does not carry its prompt"
    assert abs(svg_ratio(svg) - 16 / 9) <= ASPECT_TOLERANCE
    assert output(app_url, t, ga).text == svg
    def drawing(text, gid):
        text = re.sub(r"\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?", "", text.replace(str(gid), ""))
        for n, name in enumerate(dict.fromkeys(re.findall(r'\bid="([^"]+)"', text))):
            text = re.sub(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", f"el{n}", text)
        return text
    assert drawing(output(app_url, t, gb).text, gb) == drawing(svg, ga), "same prompt, different picture"
    assert output(app_url, outsider["token"], ga).status_code == 404
    other = f"Cold blue harbour lights {acct['tag']}"
    c = start(app_url, t, gen_body(acct["project"], "vela-image-4", other, aspect="16:9"))
    assert c.status_code == 201
    wait_status(app_url, t, c.json()["id"], {"ready"})
    assert output(app_url, t, c.json()["id"]).text.replace(str(c.json()["id"]), "") != svg.replace(str(ga), "")


def test_video_output_loops_and_image_output_holds_still(app_url):
    acct = signup(app_url, "loop")
    t = acct["token"]
    v = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", f"Tide pools at noon {acct['tag']}",
                                   duration=LONG_S, aspect="9:16"))
    i = start(app_url, t, gen_body(acct["project"], "vela-image-4", f"Salt flats at dawn {acct['tag']}",
                                   image_count=3, aspect="1:1"))
    assert v.status_code == 201 and i.status_code == 201
    wait_status(app_url, t, v.json()["id"], {"ready"})
    wait_status(app_url, t, i.json()["id"], {"ready"})
    video, image = output(app_url, t, v.json()["id"]).text, output(app_url, t, i.json()["id"]).text
    assert abs(svg_ratio(video) - 9 / 16) <= ASPECT_TOLERANCE
    assert abs(svg_ratio(image) - 1) <= ASPECT_TOLERANCE
    assert re.search(r'repeatCount\s*=\s*["\']indefinite|\binfinite\b', video), "video picture does not loop"
    assert re.search(r"(?<![\d.])10(?:\.0+)?s\b|(?<![\d.])10000ms\b"
                     r"|\bdur\s*=\s*[\"']\s*(?:0*:)?(?:0*:)?0*10(?:\.0+)?\s*[\"']", video), "loop does not span the stated length"
    assert not re.search(r"<animate|<set\b|animation(?:-name)?\s*:(?!\s*none\b)", image), "image picture moves"


def test_generation_card_updates_and_cancel_toast(page, app_url):
    live(page)
    acct = signup(app_url, "cards")
    t = acct["token"]
    still = f"Quiet orchard rows {acct['tag']}"
    moving = f"Gulls over a ferry {acct['tag']}"
    b = start(app_url, t, gen_body(acct["project"], "vela-image-4", still, image_count=2))
    a = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", moving))
    assert a.status_code == 201 and b.status_code == 201
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.goto(app_url + f"/studio/projects/{acct['project']}")
    page.evaluate("() => { window.__kinoraProbe = 1; }")
    for words in ["Vela 4 Turbo", "5 s", "16:9", f"{TURBO_PER_S * SHORT_S} credits", "Vela Image 4", "2 images",
                  f"{IMAGE_PER * 2} credits", acct["name"]]:
        see(page, words)
    scoped(page, "button", "Cancel", moving).click()
    see(page, f"Cancelled. {TURBO_PER_S * SHORT_S} credits returned.")
    see(page, "Cancelled")
    expect(shown(page.get_by_role("img", name=still))).to_be_visible(timeout=READY_UI_TIMEOUT_MS)
    see(page, re.compile(r"^Ready$"))
    assert page.evaluate("() => window.__kinoraProbe") == 1, "the page reloaded"
    refunds = entries_for(a.json()["id"], "refund")
    assert refunds and refunds[0]["amount"] == TURBO_PER_S * SHORT_S


def test_cancel_refunds_full_cost_once(app_url):
    acct = signup(app_url, "refund")
    t = acct["token"]
    cost = VELA_45_PER_S * SHORT_S
    r = start(app_url, t, gen_body(acct["project"], "vela-4.5", f"Moths at a porch light {acct['tag']}"))
    gid = r.json()["id"]
    began = time.monotonic()
    assert me(app_url, t)["balance"] == FREE_CREDITS - cost
    c = http("POST", app_url, f"/api/generations/{gid}/cancel", t)
    assert c.status_code == 200 and c.json()["status"] == "cancelled" and c.json()["finished_at"]
    assert me(app_url, t)["balance"] == FREE_CREDITS
    assert entries_for(gid, "refund") == [{"amount": cost, "balance_after": FREE_CREDITS}]
    again = http("POST", app_url, f"/api/generations/{gid}/cancel", t)
    assert again.status_code == 409
    assert len(entries_for(gid, "refund")) == 1 and me(app_url, t)["balance"] == FREE_CREDITS
    while time.monotonic() - began <= RENDER_MAX_S + TIMING_SLACK_S:
        assert http("GET", app_url, f"/api/generations/{gid}", t).json()["status"] == "cancelled"
        pause(POLL_INTERVAL_S * 4)
    assert output(app_url, t, gid).status_code == 409


def test_cancel_ready_generation_refused(app_url):
    ids = seeded_ids()
    ines = login(app_url, CREATOR)
    before = me(app_url, ines)["balance"]
    r = http("POST", app_url, f"/api/generations/{ids['neon']}/cancel", ines)
    assert r.status_code == 409
    assert q(f"SELECT status FROM generations WHERE id = {lit(ids['neon'])}")[0]["status"] == "ready"
    assert entries_for(ids["neon"], "refund") == []
    assert me(app_url, ines)["balance"] == before


def test_concurrent_cancel_refunds_once(app_url):
    acct = signup(app_url, "cancelrace")
    r = start(app_url, acct["token"], gen_body(acct["project"], "vela-4.5", f"Snow on tram wires {acct['tag']}"))
    gid = r.json()["id"]
    results = together(CONCURRENCY, lambda i: http("POST", app_url, f"/api/generations/{gid}/cancel", acct["token"]))
    codes = [x.status_code for x in results]
    assert codes.count(200) == 1 and codes.count(409) == CONCURRENCY - 1, codes
    assert len(entries_for(gid, "refund")) == 1
    assert ws_sum(acct["workspace"]) == FREE_CREDITS == me(app_url, acct["token"])["balance"]


def test_credit_history_reconciles_with_balance(app_url):
    acct = signup(app_url, "ledger")
    t = acct["token"]
    img = start(app_url, t, gen_body(acct["project"], "vela-image-4", f"Ledger stills {acct['tag']}", image_count=2))
    vid = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", f"Ledger motion {acct['tag']}"))
    assert http("POST", app_url, f"/api/generations/{vid.json()['id']}/cancel", t).status_code == 200
    body = http("GET", app_url, "/api/credits", t).json()
    entries = body["entries"]
    assert [e["kind"] for e in entries] == ["refund", "charge", "charge", "plan"]
    assert [e["amount"] for e in entries] == [TURBO_PER_S * SHORT_S, -TURBO_PER_S * SHORT_S, -IMAGE_PER * 2, FREE_CREDITS]
    running = 0
    for e in reversed(entries):
        running += e["amount"]
        assert e["balance_after"] == running >= 0
        assert e["user_name"] == acct["name"]
    assert entries[-1]["generation_id"] is None
    assert entries[0]["generation_id"] == vid.json()["id"] and entries[2]["generation_id"] == img.json()["id"]
    assert body["balance"] == running == me(app_url, t)["balance"] == ws_sum(acct["workspace"])


def test_credits_page_shows_balance_plan_and_signed_history(page, app_url):
    live(page)
    acct = signup(app_url, "creditspage")
    t = acct["token"]
    vid = start(app_url, t, gen_body(acct["project"], "vela-4-turbo", f"Credits page {acct['tag']}"))
    http("POST", app_url, f"/api/generations/{vid.json()['id']}/cancel", t)
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.goto(app_url + "/studio/credits")
    expect(page.get_by_role("heading", name="Credits", exact=True)).to_be_visible()
    see(page, amount_re(FREE_CREDITS))
    see(page, "Free, 125 credits once")
    words = page_text(page)
    for token in ["Plan credits", "Generation", "Refund", "+125", f"-{TURBO_PER_S * SHORT_S}", f"+{TURBO_PER_S * SHORT_S}"]:
        assert token in words, f"credit history lacks {token!r}"
    refund_y = shown(page.get_by_text("Refund", exact=True)).bounding_box()["y"]
    plan_y = shown(page.get_by_text("Plan credits", exact=True)).bounding_box()["y"]
    assert refund_y < plan_y, "history is not newest first"
    shown(link_or_button(page, "Log out")).click()
    expect(page).to_have_url(re.compile(r"/login/?$"))
    ui_login(page, app_url, OWNER)
    page.goto(app_url + "/studio/credits")
    see(page, "Team, 6,900 credits per seat")
    see(page, amount_re(me(app_url, login(app_url, OWNER))["balance"]))


def test_team_page_owner_invites_member_sees_none(page, browser, app_url):
    live(page)
    _, email = fresh("seat")
    owner = login(app_url, OWNER)
    try:
        assert invite(app_url, owner, email).status_code == 201
        team = http("GET", app_url, "/api/team", owner).json()
        assert team["seat_limit"] == SEAT_LIMIT
        assert team["seats_used"] == len(team["members"]) + len(team["invitations"])
        ui_login(page, app_url, OWNER)
        page.goto(app_url + "/studio/team")
        expect(page.get_by_role("heading", name="Team", exact=True)).to_be_visible()
        see(page, f"{team['seats_used']} of 9 seats used")
        for words in ["Mara Quinn", "Theo Park", MEMBER, "Owner", "Member", email]:
            see(page, words)
        expect(page.get_by_role("button", name="Invite teammate")).to_be_visible()
        expect(scoped(page, "button", "Revoke", email)).to_be_visible()
        with app_page(browser, app_url + "/login") as theo:
            live(theo)
            ui_login(theo, app_url, MEMBER)
            theo.goto(app_url + "/studio/team")
            see(theo, email)
            expect(theo.get_by_role("button", name="Invite teammate")).to_have_count(0)
            expect(theo.get_by_role("button", name="Revoke")).to_have_count(0)
            expect(theo.get_by_role("button", name="Remove")).to_have_count(0)
        with app_page(browser, app_url + "/login") as ines:
            live(ines)
            ui_login(ines, app_url, CREATOR)
            ines.goto(app_url + "/studio/team")
            see(ines, "Teams share one credit balance. Team workspaces are set up by our sales team.")
            assert ines.evaluate("() => Array.from(document.links).some((a) => new URL(a.href).pathname === '/team-plan')")
            expect(ines.get_by_role("button", name="Invite teammate")).to_have_count(0)
    finally:
        tidy_team(app_url, [email])


def test_invite_sends_one_email_with_join_link(app_url, mail):
    _, email = fresh("invitee")
    owner = login(app_url, OWNER)
    base = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    try:
        r = invite(app_url, owner, email)
        assert r.status_code == 201, r.text
        assert r.json()["email"].lower() == email.lower() and r.json()["id"] and r.json()["created_at"]
        token = invitation_token(email)
        msgs = inbox(mail, email, INVITE_SUBJECT)
        assert len(msgs) == 1, f"{len(msgs)} invitation emails"
        msg = msgs[0]
        assert addresses(msg.get("To")) and [a.lower() for a in addresses(msg.get("To"))] == [email.lower()]
        assert addresses(msg.get("Cc")) == []
        assert SENDER in [a.lower() for a in addresses(msg.get("From"))]
        body = (msg.get("Text") or "") + "\n" + html.unescape(msg.get("HTML") or "")
        assert f"{base}/invite/{token}" in body, "email lacks the full join link"
        info = http("GET", app_url, f"/api/invitations/{token}")
        assert info.status_code == 200 and info.json()["workspace_name"] == NORTHLIGHT
        assert info.json()["email"].lower() == email.lower()
    finally:
        tidy_team(app_url, [email])


def test_invite_refused_for_existing_account_or_full_team(app_url, mail):
    owner = login(app_url, OWNER)
    created: list[str] = []
    try:
        for taken in [MEMBER, MEMBER.upper(), CREATOR]:
            stored = f"SELECT COUNT(*) AS n FROM invitations WHERE lower(email) = lower({lit(taken)})"
            n_before = q(stored)[0]["n"]
            r = invite(app_url, owner, taken)
            assert r.status_code == 409, f"{taken}: {r.status_code}"
            assert q(stored)[0]["n"] == n_before
        _, pending = fresh("dupinvite")
        created.append(pending)
        assert invite(app_url, owner, pending).status_code == 201
        assert invite(app_url, owner, pending).status_code == 409
        assert len(inbox(mail, pending, INVITE_SUBJECT)) == 1
        used = http("GET", app_url, "/api/team", owner).json()["seats_used"]
        while used < SEAT_LIMIT:
            _, filler = fresh("filler")
            created.append(filler)
            assert invite(app_url, owner, filler).status_code == 201
            used += 1
        _, tenth = fresh("tenth")
        r = invite(app_url, owner, tenth)
        assert r.status_code == 409, r.text
        assert q(f"SELECT COUNT(*) AS n FROM invitations WHERE lower(email) = lower({lit(tenth)})")[0]["n"] == 0
        assert inbox(mail, tenth, expected=0) == []
        for taken in [MEMBER, CREATOR]:
            assert inbox(mail, taken, expected=0) == []
    finally:
        tidy_team(app_url, created)


def test_invite_join_adds_seat_credits_once(app_url, mail):
    _, email = fresh("joiner")
    owner = login(app_url, OWNER)
    ws = workspace_id(NORTHLIGHT)
    try:
        assert invite(app_url, owner, email).status_code == 201
        token = invitation_token(email)
        before = me(app_url, owner)["balance"]
        sum_before = ws_sum(ws)
        results = together(CONCURRENCY, lambda i: http("POST", app_url, f"/api/invitations/{token}",
                                                       body={"name": "Jo Ellis", "password": NEW_PASSWORD}))
        codes = [r.status_code for r in results]
        assert codes.count(201) == 1 and all(c in (404, 409) for c in codes if c != 201), codes
        joined = next(r for r in results if r.status_code == 201).json()
        assert joined["user"]["role"] == "member" and joined["user"]["email"].lower() == email.lower()
        assert me(app_url, owner)["balance"] == before + SEAT_CREDITS
        assert ws_sum(ws) == sum_before + SEAT_CREDITS
        users = q(f"SELECT id, role, workspace_id FROM users WHERE lower(email) = lower({lit(email)})")
        assert len(users) == 1 and users[0]["role"] == "member" and str(users[0]["workspace_id"]) == str(ws)
        seats = q(f"SELECT amount FROM credit_entries WHERE kind = 'seat' AND user_id = {lit(users[0]['id'])}")
        assert seats == [{"amount": SEAT_CREDITS}]
        assert q(f"SELECT status FROM invitations WHERE token = {lit(token)}")[0]["status"] == "accepted"
        assert http("GET", app_url, f"/api/invitations/{token}").status_code == 404
        mine = me(app_url, joined["token"])
        assert mine["workspace"]["name"] == NORTHLIGHT and mine["balance"] == before + SEAT_CREDITS
    finally:
        tidy_team(app_url, [email])


def test_invite_link_join_full_page_confirmation(page, browser, app_url, mail):
    live(page)
    tag, email = fresh("jo.ellis")
    base = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    owner = login(app_url, OWNER)
    try:
        ui_login(page, app_url, OWNER)
        page.goto(app_url + "/studio/team")
        see(page, "seats used")
        page.get_by_role("button", name="Invite teammate").click()
        dialog = page.get_by_role("dialog", name="Invite teammate")
        dialog.get_by_label("Email").fill(email)
        dialog.get_by_role("button", name="Send invite").click()
        msgs = inbox(mail, email, INVITE_SUBJECT)
        assert len(msgs) == 1
        if dialog.is_visible():
            page.keyboard.press("Escape")
        expect(dialog).to_be_hidden(timeout=UI_TIMEOUT_MS)
        see(page, email)
        body = (msgs[0].get("Text") or "") + "\n" + html.unescape(msgs[0].get("HTML") or "")
        found = re.search(re.escape(base) + r"/invite/[^\s\"'<>]+", body)
        assert found, "no join link in the email"
        link = found.group(0)
        with app_page(browser, link) as jo:
            live(jo)
            see(jo, "Join Northlight Studio on Kinora")
            shown_email = jo.evaluate(
                "(e) => document.body.innerText.toLowerCase().includes(e.toLowerCase()) || "
                "Array.from(document.getElementsByTagName('input')).some((i) => i.value.toLowerCase() === e.toLowerCase() && (i.readOnly || i.disabled))",
                email)
            assert shown_email, "the invited email is not shown fixed"
            jo.get_by_label("Name", exact=True).fill(f"Jo Ellis {tag}"[:NAME_MAX])
            jo.get_by_label("Password", exact=True).fill(NEW_PASSWORD)
            jo.get_by_role("button", name="Join team").click()
            see(jo, re.compile(r"You['\u2019]re in\. Welcome to Northlight Studio\."))
            shown(link_or_button(jo, "Open the studio")).click()
            expect(jo).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)
            see(jo, amount_re(me(app_url, owner)["balance"]))
            jo.goto(link)
            see(jo, "This invitation is no longer valid.")
        users = q(f"SELECT id, role FROM users WHERE lower(email) = lower({lit(email)})")
        assert len(users) == 1 and users[0]["role"] == "member"
        assert len(q(f"SELECT id FROM credit_entries WHERE kind = 'seat' AND user_id = {lit(users[0]['id'])}")) == 1
    finally:
        tidy_team(app_url, [email])


def test_revoked_invitation_and_removed_member_denied(page, app_url, mail):
    live(page)
    owner = login(app_url, OWNER)
    ws = workspace_id(NORTHLIGHT)
    _, email_a = fresh("revoked")
    _, email_b = fresh("removed")
    try:
        assert invite(app_url, owner, email_a).status_code == 201
        token_a = invitation_token(email_a)
        inv_id = next(i["id"] for i in http("GET", app_url, "/api/team", owner).json()["invitations"]
                      if i["email"].lower() == email_a.lower())
        r = http("DELETE", app_url, f"/api/team/invitations/{inv_id}", owner)
        assert r.status_code in (200, 204), r.text
        assert http("GET", app_url, f"/api/invitations/{token_a}").status_code == 404
        assert http("POST", app_url, f"/api/invitations/{token_a}",
                    body={"name": "Late", "password": NEW_PASSWORD}).status_code == 404
        assert q(f"SELECT status FROM invitations WHERE token = {lit(token_a)}")[0]["status"] == "revoked"
        assert q(f"SELECT COUNT(*) AS n FROM users WHERE lower(email) = lower({lit(email_a)})")[0]["n"] == 0
        assert http("DELETE", app_url, f"/api/team/invitations/{inv_id}", owner).status_code == 404
        page.goto(app_url + f"/invite/{token_a}")
        see(page, "This invitation is no longer valid.")

        assert invite(app_url, owner, email_b).status_code == 201
        token_b = invitation_token(email_b)
        joined = http("POST", app_url, f"/api/invitations/{token_b}", body={"name": "Removed Person", "password": NEW_PASSWORD})
        assert joined.status_code == 201
        member_token = joined.json()["token"]
        spring = seeded_ids()["spring"]
        g = start(app_url, member_token, gen_body(spring, prompt=f"Left behind {email_b}"))
        assert g.status_code == 201
        balance_before = me(app_url, owner)["balance"]
        sum_before = ws_sum(ws)
        mid = member_id(app_url, owner, email_b)
        r = http("DELETE", app_url, f"/api/team/members/{mid}", owner)
        assert r.status_code in (200, 204), r.text
        for method, path in [("GET", "/api/me"), ("GET", "/api/projects"), ("GET", "/api/credits")]:
            assert http(method, app_url, path, member_token).status_code == 401
        assert start(app_url, member_token, gen_body(spring, prompt="After removal")).status_code == 401
        denied = http("POST", app_url, "/api/auth/login", body={"email": email_b, "password": NEW_PASSWORD})
        assert denied.status_code in (401, 403) and "token" not in denied.text, denied.text
        assert me(app_url, owner)["balance"] == balance_before and ws_sum(ws) == sum_before
        assert len(entries_for(g.json()["id"], "charge")) == 1 and entries_for(g.json()["id"], "refund") == []
        assert q(f"SELECT COUNT(*) AS n FROM generations WHERE id = {lit(g.json()['id'])}")[0]["n"] == 1
        uid = q(f"SELECT id FROM users WHERE lower(email) = lower({lit(email_b)})")[0]["id"]
        seats = q(f"SELECT amount FROM credit_entries WHERE kind = 'seat' AND user_id = {lit(uid)}")
        assert seats == [{"amount": SEAT_CREDITS}]
        mara = member_id(app_url, owner, OWNER)
        r = http("DELETE", app_url, f"/api/team/members/{mara}", owner)
        assert r.status_code == 409 and r.json() == {"error": "cannot_remove_self"}
        assert q(f"SELECT removed_at FROM users WHERE id = {lit(mara)}")[0]["removed_at"] is None
        assert http("GET", app_url, "/api/me", owner).status_code == 200
    finally:
        tidy_team(app_url, [email_a, email_b])


def test_member_denied_team_management(app_url, mail):
    owner, theo, ines = login(app_url, OWNER), login(app_url, MEMBER), login(app_url, CREATOR)
    _, pending = fresh("pending")
    _, denied = fresh("denied")
    try:
        assert invite(app_url, owner, pending).status_code == 201
        inv_id = next(i["id"] for i in http("GET", app_url, "/api/team", owner).json()["invitations"]
                      if i["email"].lower() == pending.lower())
        mara_id, theo_id = member_id(app_url, owner, OWNER), member_id(app_url, owner, MEMBER)
        r = http("POST", app_url, "/api/team/invitations", theo, {"email": denied, "role": "owner"})
        assert r.status_code == 403, r.text
        assert http("DELETE", app_url, f"/api/team/invitations/{inv_id}", theo).status_code == 403
        assert http("DELETE", app_url, f"/api/team/members/{mara_id}", theo).status_code == 403
        assert http("DELETE", app_url, f"/api/team/members/{theo_id}", theo).status_code == 403
        assert invite(app_url, ines, denied).status_code == 403
        assert http("DELETE", app_url, f"/api/team/invitations/{inv_id}", ines).status_code in (403, 404)
        assert http("DELETE", app_url, f"/api/team/members/{theo_id}", ines).status_code in (403, 404)
        assert q(f"SELECT COUNT(*) AS n FROM invitations WHERE lower(email) = lower({lit(denied)})")[0]["n"] == 0
        assert q(f"SELECT status FROM invitations WHERE id = {lit(inv_id)}")[0]["status"] == "pending"
        for uid in (mara_id, theo_id):
            assert q(f"SELECT removed_at FROM users WHERE id = {lit(uid)}")[0]["removed_at"] is None
        assert http("GET", app_url, "/api/me", theo).status_code == 200
        assert inbox(mail, denied, expected=0) == []
    finally:
        tidy_team(app_url, [pending])


def test_enquiry_form_errors_keep_values_then_confirmation(page, app_url):
    live(page)
    tag, email = fresh("form")
    company = f"Harbour & Pine {tag}"
    page.goto(app_url + "/enterprise-contact")
    size = page.get_by_role("combobox", name=re.compile("Company Size"))
    industry = page.get_by_role("combobox", name=re.compile("Industry"))
    for box, wanted in [(size, COMPANY_SIZES), (industry, INDUSTRIES)]:
        if box.evaluate("(s) => s.tagName === 'SELECT'"):
            assert box.evaluate("(s) => Array.from(s.options).map((o) => o.text.trim())") == ["Select an option"] + wanted
        else:
            shown_text = box.evaluate("(s) => [s.textContent, s.getAttribute('placeholder'), s.value].join(' ')")
            box.click()
            names = [n.strip() for n in page.get_by_role("option").all_inner_texts()]
            page.keyboard.press("Escape")
            assert "Select an option" in shown_text or "Select an option" in names
            assert [n for n in names if n != "Select an option"] == wanted
    for name in ["Creative Platform", "API", "Model Weights Licensing", "Kinora Ads"]:
        expect(page.get_by_role("checkbox", name=re.compile(re.escape(name))).first).to_be_attached()
    page.get_by_role("button", name="Submit").click()
    for label in CONTACT_REQUIRED:
        field = page.get_by_label(re.compile(r"^" + re.escape(label) + r"\s*\*?$")).first
        labels = field.evaluate(
            "(el) => { const tied = ((el.getAttribute('aria-describedby') || '') + ' ' + (el.getAttribute('aria-errormessage') || ''))"
            ".split(/\\s+/).filter(Boolean);"
            " const own = (l) => { const c = l.cloneNode(true);"
            " c.querySelectorAll('input, select, textarea, option, [role=alert], [role=listbox], [role=option]').forEach((n) => n.remove());"
            " tied.forEach((i) => c.querySelectorAll('#' + CSS.escape(i)).forEach((n) => n.remove()));"
            " const after = getComputedStyle(l, '::after').content;"
            " const drawn = after && after !== 'none' && after !== 'normal' ? after.replace(/^[\"']|[\"']$/g, '') : '';"
            " return ((c.textContent || '') + drawn).trim(); };"
            " return [...(el.labels || []), ...(el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)"
            ".map((i) => document.getElementById(i)).filter(Boolean)].map(own)"
            ".concat([el.getAttribute('aria-label') || '']); }")
        assert any(t.endswith("*") for t in labels), f"{label} label does not end with an asterisk"
        end = time.monotonic() + UI_TIMEOUT_MS / 1000
        while not (tie := field.evaluate(TIED_JS))["described"] and time.monotonic() < end:
            pause(POLL_INTERVAL_S)
        assert tie["described"], f"{label} has no message tied to it"
        assert tie["announced"] or page.get_by_role("alert").count() > 0, f"{label} message is not announced"
    page.get_by_label(re.compile(r"^First Name")).first.fill("Lena")
    page.get_by_label(re.compile(r"^Business Email")).first.fill("Harbour & Pine")
    page.get_by_role("button", name="Submit").click()
    expect(page.get_by_label(re.compile(r"^First Name")).first).to_have_value("Lena")
    expect(page.get_by_label(re.compile(r"^Business Email")).first).to_have_value("Harbour & Pine")
    assert page.get_by_label(re.compile(r"^Business Email")).first.evaluate(TIED_JS)["described"]
    assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE company = {lit(company)}")[0]["n"] == 0
    page.get_by_label(re.compile(r"^Last Name")).first.fill("Rowe")
    page.get_by_label(re.compile(r"^Business Email")).first.fill(email)
    page.get_by_label(re.compile(r"^Company\s*\*?$")).first.fill(company)
    select(size, "1-200")
    select(industry, "Gaming")
    page.get_by_role("checkbox", name="API", exact=True).check()
    page.get_by_label(re.compile(r"^Message")).first.fill("We want launch films for three product lines.")
    page.get_by_role("button", name="Submit").click()
    expect(page.get_by_role("heading", name="Thanks, we will be in touch within two business days.")).to_be_visible(timeout=UI_TIMEOUT_MS)
    assert path_of(app_url, page.get_by_role("link", name="Back to home").first.get_attribute("href")) == "/"
    assert q(f"SELECT source FROM enquiries WHERE company = {lit(company)}") == [{"source": "contact"}]
    page.goto(app_url + "/enterprise")
    expect(page.get_by_label(re.compile(r"^First Name")).first).to_be_attached()
    page.goto(app_url + "/model-licensing")
    expect(page.get_by_label(re.compile(r"^Full Name")).first).to_be_attached()


def test_enquiry_sends_sales_and_confirmation_email(app_url, mail):
    tag, email = fresh("buyer")
    company = f"Harbour & Pine {tag}"
    body = contact_body(email, company)
    r = http("POST", app_url, "/api/enquiries", body=body)
    assert r.status_code == 201, r.text
    assert r.json()["email"] == email and r.json()["company"] == company and r.json()["source"] == "contact"
    rows = q(f"SELECT source, first_name, last_name, company_size, industry, products::text AS products FROM enquiries WHERE email = {lit(email)}")
    assert len(rows) == 1 and rows[0]["source"] == "contact" and rows[0]["first_name"] == "Lena"
    assert "creative-platform" in rows[0]["products"] and "api" in rows[0]["products"]
    sales = inbox(mail, SALES, f"New enterprise enquiry from {company}")
    assert len(sales) == 1, f"{len(sales)} sales emails"
    words = text(sales[0])
    for part in ["Lena", "Hart", email, company, "201-1,000", "Gaming", body["message"]]:
        assert part in words, f"sales email lacks {part!r}"
    assert re.search(r"Creative Platform|creative-platform", words), "sales email lacks the products"
    assert [a.lower() for a in addresses(sales[0].get("To"))] == [SALES]
    ack = inbox(mail, email, ACK_SUBJECT)
    assert len(ack) == 1 and "two business days" in text(ack[0])
    assert [a.lower() for a in addresses(ack[0].get("To"))] == [email.lower()]
    assert SENDER in [a.lower() for a in addresses(ack[0].get("From"))]


def test_licensing_enquiry_stored_with_interest(app_url, mail):
    tag, email = fresh("licensee")
    company = f"Licensing Lab {tag}"
    body = {"source": "licensing", "first_name": None, "last_name": None, "full_name": "Lena Hart", "email": email,
            "company": company, "company_size": "1,001-5,000", "industry": "Automotive", "products": None,
            "message": "We would like to fine-tune the weights on our own footage."}
    r = http("POST", app_url, "/api/enquiries", body=body)
    assert r.status_code == 201, r.text
    rows = q(f"SELECT source, full_name, products FROM enquiries WHERE email = {lit(email)}")
    assert rows == [{"source": "licensing", "full_name": "Lena Hart", "products": None}]
    assert len(inbox(mail, SALES, f"New enterprise enquiry from {company}")) == 1
    assert len(inbox(mail, email, ACK_SUBJECT)) == 1


def test_enquiry_invalid_fields_rejected(app_url, mail):
    tag, email = fresh("badenquiry")
    company = f"Nowhere Works {tag}"
    cases = [
        ({"first_name": ""}, {"first_name"}),
        ({"email": "not-an-email"}, {"email"}),
        ({"message": "x" * (MESSAGE_MIN - 1)}, {"message"}),
        ({"company_size": "50"}, {"company_size"}),
        ({"industry": "Space"}, {"industry"}),
        ({"products": []}, {"products"}),
        ({"products": ["bogus"]}, {"products"}),
        ({"email": "nope", "message": "short"}, {"email", "message"}),
    ]
    for over, fields in cases:
        r = http("POST", app_url, "/api/enquiries", body=contact_body(email, company, **over))
        assert r.status_code == 422, f"{over}: {r.status_code}"
        assert fields <= set(r.json()["errors"]), r.json()
    r = http("POST", app_url, "/api/enquiries", body={"source": "licensing", "full_name": "", "email": email,
                                                       "company": company, "company_size": "1-200",
                                                       "industry": "Gaming", "message": "Valid message here."})
    assert r.status_code == 422 and "full_name" in r.json()["errors"]
    assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE email = {lit(email)} OR company = {lit(company)}")[0]["n"] == 0
    assert inbox(mail, email, expected=0) == []
    assert inbox(mail, SALES, f"New enterprise enquiry from {company}", expected=0) == []


def test_mail_outage_keeps_stored_invitation_and_enquiry(app_url, mail):
    down = os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/")
    _, invited = fresh("outage-invite")
    tag, email = fresh("outage-enquiry")
    company = f"Outage Works {tag}"
    try:
        owner = login(down, OWNER)
        r = invite(down, owner, invited)
        assert r.status_code == 201, r.text
        assert q(f"SELECT status FROM invitations WHERE lower(email) = lower({lit(invited)})") == [{"status": "pending"}]
        e = http("POST", down, "/api/enquiries", body=contact_body(email, company))
        assert e.status_code == 201, e.text
        assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE email = {lit(email)}")[0]["n"] == 1
        assert inbox(mail, invited, expected=0) == []
    finally:
        tidy_team(app_url, [invited])


def test_wf_cross_cutting_public_visit(page, app_url):
    live(page)
    outside = []

    def watch(req):
        if not req.url.startswith(("data:", "blob:", "about:")) and not same_origin(req.url, app_url):
            outside.append(req.url)

    page.on("request", watch)
    page.goto(app_url + "/")
    pricing = page.get_by_role("link", name="Pricing", exact=True)
    expect(pricing.first).to_be_attached()
    next(p for p in visible_items(pricing)
         if p.evaluate("(a) => a.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})")).click()
    expect(page.get_by_role("heading", level=1, name="Choose the Right Plan for You")).to_be_visible()
    assert not outside
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_cross_cutting_not_found_recovery(page, app_url):
    live(page)
    resp = page.goto(app_url + NOT_FOUND_PROBES[0])
    assert resp is not None and resp.status == 404
    page.get_by_role("link", name="Back to home").click()
    expect(page.get_by_role("heading", level=1, name="Building Real-World Intelligence")).to_be_visible()


def test_wf_public_site_pricing_to_signup(page, app_url, mail):
    live(page)
    tag, email = fresh("pricingflow")
    page.goto(app_url + "/pricing")
    shown(link_or_button(page, "Start Free")).click()
    expect(page).to_have_url(re.compile(r"/signup/?$"))
    ui_signup(page, f"Pricing Visitor {tag}"[:NAME_MAX], email)
    expect(page).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)
    rows = q(f"SELECT w.plan, u.role, w.id FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE lower(u.email) = lower({lit(email)})")
    assert len(rows) == 1 and rows[0]["plan"] == "free" and rows[0]["role"] == "owner"
    assert ws_sum(rows[0]["id"]) == FREE_CREDITS
    assert inbox(mail, email, expected=0) == []


def test_wf_public_site_keyboard_menu_to_examples(page, app_url):
    live(page)
    page.goto(app_url + "/")
    page.get_by_role("button", name="Creative", exact=True).first.focus()
    page.keyboard.press("Enter")
    for _ in range(FOCUS_PRESSES):
        page.keyboard.press("Tab")
        if page.evaluate("() => { const a = document.activeElement; return !!a && a.tagName === 'A' && "
                         "new URL(a.href, location.href).pathname.replace(/\\/$/, '') === '/examples'; }"):
            break
    else:
        pytest.fail("Tab never reached Examples in the Creative menu")
    page.keyboard.press("Enter")
    expect(page).to_have_url(re.compile(r"/examples/?$"))
    total = httpx.get(app_url + "/api/examples", timeout=HTTP_TIMEOUT_S).json()["total"]
    see(page, f"{total} examples")


def test_wf_accounts_signup_happy(page, app_url, mail):
    live(page)
    tag, email = fresh("happy")
    name = f"Happy {tag}"[:NAME_MAX]
    page.goto(app_url + "/signup")
    ui_signup(page, name, email)
    expect(page).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)
    see(page, amount_re(FREE_CREDITS))
    see(page, f"{name}'s workspace")
    ws = q(f"SELECT workspace_id FROM users WHERE lower(email) = lower({lit(email)})")[0]["workspace_id"]
    assert [p["name"] for p in q(f"SELECT name FROM projects WHERE workspace_id = {lit(ws)}")] == ["My first project"]
    assert inbox(mail, email, expected=0) == []


def test_wf_accounts_duplicate_recovery(page, app_url):
    live(page)
    tag, email = fresh("recover")
    name = f"Recover {tag}"[:NAME_MAX]
    page.goto(app_url + "/signup")
    ui_signup(page, name, CREATOR.upper())
    see(page, "An account with this email already exists.")
    expect(page.get_by_label("Name", exact=True)).to_have_value(name)
    assert q(f"SELECT COUNT(*) AS n FROM users WHERE lower(email) = {lit(CREATOR)}")[0]["n"] == 1
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_role("button", name="Sign up").click()
    expect(page).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)
    assert q(f"SELECT COUNT(*) AS n FROM users WHERE lower(email) = lower({lit(email)})")[0]["n"] == 1


def test_wf_accounts_login_logout(page, app_url):
    live(page)
    page.goto(app_url + "/login")
    page.get_by_label("Email", exact=True).fill(MEMBER)
    page.get_by_label("Password", exact=True).fill("wrong-password-0")
    page.get_by_role("button", name="Log in").click()
    see(page, "Email or password is incorrect.")
    ui_login(page, app_url, MEMBER.upper())
    see(page, "Theo Park")
    see(page, NORTHLIGHT)
    shown(link_or_button(page, "Log out")).click()
    expect(page).to_have_url(re.compile(r"/login/?$"))
    page.goto(app_url + "/studio")
    expect(page).to_have_url(re.compile(r"/login/?(\?.*)?$"))
    assert login(app_url, MEMBER)


def test_wf_projects_dialog_keyboard(page, app_url):
    live(page)
    tag, _ = fresh("kbdproj")
    name = f"Keyboard {tag}"
    owner = login(app_url, OWNER)
    ui_login(page, app_url, OWNER)
    page.goto(app_url + "/studio/projects")
    page.get_by_role("button", name="New project", exact=True).first.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name="New project")
    expect(dialog).to_be_visible()
    dialog.get_by_label("Project name").focus()
    page.keyboard.type(name)
    page.keyboard.press("Enter")
    expect(dialog).to_be_hidden(timeout=UI_TIMEOUT_MS)
    assert http("GET", app_url, "/api/projects", owner).json()[0]["name"] == name


def test_wf_projects_free_limit_message(page, app_url):
    live(page)
    acct = signup(app_url, "freelimit")
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.goto(app_url + "/studio/projects")
    page.get_by_role("button", name="New project", exact=True).first.click()
    dialog = page.get_by_role("dialog", name="New project")
    dialog.get_by_label("Project name").fill(f"Second {acct['tag']}")
    dialog.get_by_role("button", name="Create").click()
    see(page, "Your plan allows up to 1 project.")
    assert ws_count("projects", acct["workspace"]) == FREE_PROJECTS


def test_wf_generation_credits_cancel_refund(page, app_url):
    live(page)
    ines = login(app_url, CREATOR)
    ids = seeded_ids()
    before = me(app_url, ines)["balance"]
    cost = TURBO_PER_S * SHORT_S
    tag, _ = fresh("ines")
    prompt = f"Neon rain on a rooftop {tag}"
    gid = None
    try:
        ui_login(page, app_url, CREATOR)
        page.get_by_role("radio", name="Vela 4 Turbo", exact=True).click()
        page.get_by_role("radio", name="5 seconds").click()
        select(page.get_by_role("combobox", name="Project"), "Music video")
        page.get_by_role("textbox", name="Prompt").fill(prompt)
        page.get_by_role("button", name="Generate", exact=True).click()
        see(page, amount_re(before - cost))
        gid = q(f"SELECT id FROM generations WHERE prompt = {lit(prompt)}")[0]["id"]
        page.goto(app_url + f"/studio/projects/{ids['music']}")
        scoped(page, "button", "Cancel", prompt).click()
        see(page, f"Cancelled. {cost} credits returned.")
        see(page, amount_re(before))
        page.goto(app_url + "/studio/credits")
        refund = shown(page.get_by_text(re.compile(r"\bRefund\b"))).bounding_box()
        charge = shown(page.get_by_text(re.compile(r"\bGeneration\b"))).bounding_box()
        assert refund["y"] < charge["y"]
        words = page_text(page)
        assert f"+{cost}" in words and f"-{cost}" in words
        assert len(entries_for(gid, "refund")) == 1 and me(app_url, ines)["balance"] == before
    finally:
        if gid is not None:
            http("POST", app_url, f"/api/generations/{gid}/cancel", ines)


def test_wf_generation_credits_parallel_limit_message(page, app_url):
    live(page)
    acct = signup(app_url, "laneui")
    for i in range(FREE_PARALLEL):
        assert start(app_url, acct["token"], gen_body(acct["project"], prompt=f"Lane {i} {acct['tag']}")).status_code == 201
    ui_login(page, app_url, acct["email"], NEW_PASSWORD)
    page.get_by_role("radio", name="Vela Image 4", exact=True).click()
    page.get_by_role("textbox", name="Prompt").fill(f"One more {acct['tag']}")
    page.get_by_role("button", name="Generate", exact=True).click()
    see(page, f"Your plan runs {FREE_PARALLEL} generations at a time. Wait for one to finish.")
    assert ws_count("generations", acct["workspace"]) == FREE_PARALLEL
    assert ws_sum(acct["workspace"]) == FREE_CREDITS - FREE_PARALLEL * TURBO_PER_S * SHORT_S


def test_wf_team_revoke_ui(page, app_url):
    live(page)
    _, email = fresh("revokeui")
    owner = login(app_url, OWNER)
    try:
        assert invite(app_url, owner, email).status_code == 201
        token = invitation_token(email)
        ui_login(page, app_url, OWNER)
        page.goto(app_url + "/studio/team")
        revoke = page.get_by_role("button", name=re.compile(r"^Revoke\b"))
        page.locator("*").filter(has_text=email).filter(has=revoke).last.get_by_role(
            "button", name=re.compile(r"^Revoke\b")).click()
        page.wait_for_function(
            "(e) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;"
            " while ((n = w.nextNode())) { const p = n.parentElement;"
            " if (!n.textContent.includes(e) || !p.getClientRects().length) continue;"
            " const live = p.closest('[role=status],[role=alert],[aria-live]');"
            " if (!live || live.querySelector('button')) return false; } return true; }",
            arg=email, timeout=UI_TIMEOUT_MS)
        assert http("GET", app_url, f"/api/invitations/{token}").status_code == 404
        assert q(f"SELECT status FROM invitations WHERE token = {lit(token)}")[0]["status"] == "revoked"
    finally:
        tidy_team(app_url, [email])


def test_wf_team_remove_member_ui(page, app_url):
    live(page)
    _, email = fresh("removeui")
    owner = login(app_url, OWNER)
    try:
        assert invite(app_url, owner, email).status_code == 201
        joined = http("POST", app_url, f"/api/invitations/{invitation_token(email)}",
                      body={"name": "Leaving Person", "password": NEW_PASSWORD})
        assert joined.status_code == 201
        member_token = joined.json()["token"]
        assert http("GET", app_url, "/api/me", member_token).status_code == 200
        ui_login(page, app_url, OWNER)
        page.goto(app_url + "/studio/team")
        scoped(page, "button", "Remove", email).click()
        dialog = page.get_by_role("dialog", name="Remove member")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name=re.compile(r"^Remove", re.I)).click()
        expect(dialog).to_be_hidden(timeout=UI_TIMEOUT_MS)
        assert http("GET", app_url, "/api/me", member_token).status_code == 401
        assert q(f"SELECT removed_at FROM users WHERE lower(email) = lower({lit(email)})")[0]["removed_at"] is not None
    finally:
        tidy_team(app_url, [email])


def test_wf_enquiries_contact_happy(page, app_url, mail):
    live(page)
    tag, email = fresh("journey4")
    company = f"Harbour & Pine {tag}"
    page.goto(app_url + "/enterprise-contact")
    page.get_by_label(re.compile(r"^First Name")).first.fill("Ada")
    page.get_by_label(re.compile(r"^Last Name")).first.fill("Rowe")
    page.get_by_label(re.compile(r"^Business Email")).first.fill(email)
    page.get_by_label(re.compile(r"^Company\s*\*?$")).first.fill(company)
    select(page.get_by_role("combobox", name=re.compile("Company Size")), "201-1,000")
    select(page.get_by_role("combobox", name=re.compile("Industry")), "Creative Agency")
    page.get_by_role("checkbox", name="Creative Platform", exact=True).check()
    page.get_by_label(re.compile(r"^Message")).first.fill("A spring campaign across six markets.")
    page.get_by_role("button", name="Submit").click()
    see(page, "Thanks, we will be in touch within two business days.")
    assert len(inbox(mail, SALES, f"New enterprise enquiry from {company}")) == 1
    assert len(inbox(mail, email, ACK_SUBJECT)) == 1


def test_wf_enquiries_licensing_ui(page, app_url, mail):
    live(page)
    tag, email = fresh("licui")
    company = f"Weights Co {tag}"
    page.goto(app_url + "/model-licensing")
    page.get_by_label(re.compile(r"^Full Name")).first.fill("Ada Rowe")
    page.get_by_label(re.compile(r"^Business Email")).first.fill(email)
    page.get_by_label(re.compile(r"^Company\s*\*?$")).first.fill(company)
    select(page.get_by_role("combobox", name=re.compile("Company Size")), "10,001+")
    select(page.get_by_role("combobox", name=re.compile("Industry")), "Automotive")
    page.get_by_label(re.compile(r"^Message")).first.fill("Self-hosting the weights on our own cluster.")
    page.get_by_role("button", name="Submit").click()
    see(page, "Thanks, we will be in touch within two business days.")
    assert q(f"SELECT source FROM enquiries WHERE email = {lit(email)}") == [{"source": "licensing"}]
    assert len(inbox(mail, SALES, f"New enterprise enquiry from {company}")) == 1


def test_wf_enquiries_invalid_recovery(page, app_url, mail):
    live(page)
    tag, email = fresh("recoverform")
    company = f"Fixed Later {tag}"
    page.goto(app_url + "/enterprise-contact")
    page.get_by_label(re.compile(r"^Company\s*\*?$")).first.fill(company)
    page.get_by_role("button", name="Submit").click()
    expect(page.get_by_label(re.compile(r"^Company\s*\*?$")).first).to_have_value(company)
    assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE company = {lit(company)}")[0]["n"] == 0
    page.get_by_label(re.compile(r"^First Name")).first.fill("Ada")
    page.get_by_label(re.compile(r"^Last Name")).first.fill("Rowe")
    page.get_by_label(re.compile(r"^Business Email")).first.fill(email)
    select(page.get_by_role("combobox", name=re.compile("Company Size")), "1-200")
    select(page.get_by_role("combobox", name=re.compile("Industry")), "Other")
    page.get_by_role("checkbox", name="Kinora Ads", exact=True).check()
    page.get_by_label(re.compile(r"^Message")).first.fill("Ads for a small coffee roaster.")
    page.get_by_role("button", name="Submit").click()
    see(page, "Thanks, we will be in touch within two business days.")
    assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE company = {lit(company)}")[0]["n"] == 1
    assert len(inbox(mail, email, ACK_SUBJECT)) == 1


CENTS_PER_DOLLAR = 100
MONTHS_PER_YEAR = 12
PUBLISHED_SAVINGS = [36, 84, 228]


def test_wf_public_site_yearly_savings_add_up(page, app_url):
    live(page)
    plans = {p["id"]: p for p in httpx.get(app_url + "/api/plans", timeout=HTTP_TIMEOUT_S).json()}
    page.goto(app_url + "/pricing")
    expect(page.get_by_role("switch", name="Yearly billing")).to_be_checked()
    savings = []
    for pid in ("standard", "pro", "max"):
        plan = plans[pid]
        saving = (plan["monthly_price"] - plan["yearly_price"]) * MONTHS_PER_YEAR // CENTS_PER_DOLLAR
        savings.append(saving)
        see(page, f"Billed annually. Save ${saving}/year.")
        see(page, f"${plan['yearly_price'] // CENTS_PER_DOLLAR}")
        assert page.evaluate(STRUCK_JS, f"${plan['monthly_price'] // CENTS_PER_DOLLAR}"), f"{pid} monthly price not struck"
    assert savings == PUBLISHED_SAVINGS


def test_wf_accounts_private_fields_stay_private(page, app_url, mail):
    live(page)
    tag, email = fresh("private")
    page.goto(app_url + "/signup")
    ui_signup(page, f"Private {tag}"[:NAME_MAX], email)
    expect(page).to_have_url(re.compile(r"/studio/?$"), timeout=UI_TIMEOUT_MS)

    def secrets(address: str, plain: str) -> list[str]:
        row = q(f"SELECT * FROM users WHERE lower(email) = lower({lit(address)})")[0]
        return [plain] + [str(v) for k, v in row.items() if v and re.search(r"password|hash", k)]

    hidden = secrets(email, NEW_PASSWORD) + secrets(MEMBER, PASSWORD)
    r = http("POST", app_url, "/api/auth/login", body={"email": email, "password": NEW_PASSWORD})
    assert r.status_code == 200
    token = r.json()["token"]
    payloads = [r.text] + [http("GET", app_url, path, token).text
                           for path in ["/api/me", "/api/projects", "/api/credits", "/api/team"]]
    payloads.append(http("GET", app_url, "/api/team", login(app_url, OWNER)).text)
    payloads.append(http("GET", app_url, "/api/me", login(app_url, MEMBER)).text)
    page.goto(app_url + "/studio/team")
    see(page, "Teams share one credit balance. Team workspaces are set up by our sales team.")
    payloads.append(page.content())
    for body in payloads:
        for secret in hidden:
            assert secret not in body, "a password or its hash reached a payload"
    assert inbox(mail, email, expected=0) == []


DST_ZONE = "America/New_York"
FALL_BACK = "2026-11-01T05:30:00Z"
REPEAT_HOUR = "01:00:00"


def test_wf_projects_repeated_hour_newest_first(browser, app_url):
    tag, _ = fresh("dst")
    first, second = f"Before {tag}", f"After {tag}"
    ws = workspace_id(NORTHLIGHT)
    owner = login(app_url, OWNER)
    ctx = browser.new_context(timezone_id=DST_ZONE, viewport=DESKTOP)
    try:
        p = ctx.new_page()
        p.clock.install(time=FALL_BACK)
        ui_login(p, app_url, OWNER)
        p.goto(app_url + "/studio/projects")
        for name in (first, second):
            p.get_by_role("button", name="New project", exact=True).first.click()
            dialog = p.get_by_role("dialog", name="New project")
            dialog.get_by_label("Project name").fill(name)
            dialog.get_by_role("button", name="Create").click()
            expect(dialog).to_be_hidden(timeout=UI_TIMEOUT_MS)
            see(p, name)
            if name == first:
                p.clock.fast_forward(REPEAT_HOUR)
        p.reload()
        a = shown(p.get_by_text(first, exact=True))
        b = shown(p.get_by_text(second, exact=True))
        expect(a).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(b).to_be_visible(timeout=UI_TIMEOUT_MS)
        ba, bb = a.bounding_box(), b.bounding_box()
        assert (round(bb["y"]), bb["x"]) < (round(ba["y"]), ba["x"]), "the newer project is not listed first"
    finally:
        ctx.close()
    listed = [row["name"] for row in http("GET", app_url, "/api/projects", owner).json()]
    assert listed.index(second) < listed.index(first)
    for name in (first, second):
        assert ws_count("projects", ws, f"name = {lit(name)}") == 1


FAR_ZONE = "Pacific/Kiritimati"


def test_wf_generation_credits_history_shows_utc_times(browser, app_url):
    acct = signup(app_url, "utc")
    raw = http("GET", app_url, "/api/credits", acct["token"]).json()["entries"][0]["created_at"]
    at = datetime.fromtimestamp(raw / 1000 if raw > 1e11 else raw, timezone.utc) if isinstance(raw, (int, float)) else iso(raw)
    at = (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    local = at.astimezone(ZoneInfo(FAR_ZONE))
    ctx = browser.new_context(timezone_id=FAR_ZONE, viewport=DESKTOP)
    try:
        p = ctx.new_page()
        ui_login(p, app_url, acct["email"], NEW_PASSWORD)
        p.goto(app_url + "/studio/credits")
        see(p, "Plan credits")
        words = page_text(p)
    finally:
        ctx.close()
    utc_forms = {f"{at.hour:02d}:{at.minute:02d}", f"{at.hour % 12 or 12}:{at.minute:02d}"}
    assert any(form in words for form in utc_forms), f"no UTC time {utc_forms} on the credits page"
    assert f"{local.hour:02d}:{local.minute:02d}" not in words, "the row shows the browser's local time"


def test_wf_enquiries_file_upload_refused(page, app_url, mail):
    live(page)
    page.goto(app_url + "/enterprise-contact")
    expect(page.get_by_role("button", name="Submit")).to_be_visible()
    assert page.evaluate(
        "() => Array.from(document.getElementsByTagName('input')).filter((i) => i.type === 'file').length") == 0
    tag, email = fresh("upload")
    company = f"Harbour & Pine {tag}"
    fields = {k: v for k, v in contact_body(email, company).items() if isinstance(v, str)}
    crafted = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = httpx.post(app_url + "/api/enquiries", data=fields,
                   files={"file": ("../../brief.svg", crafted, "image/svg+xml")},
                   timeout=HTTP_TIMEOUT_S)
    assert r.is_client_error, f"multipart enquiry answered {r.status_code}"
    assert q(f"SELECT COUNT(*) AS n FROM enquiries WHERE email = {lit(email)} OR company = {lit(company)}")[0]["n"] == 0
    assert inbox(mail, email, expected=0) == []
    assert inbox(mail, SALES, f"New enterprise enquiry from {company}", expected=0) == []


APP_ROOT = Path("/app")


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key
    for name in ["Dockerfile", "start.sh", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]:
        assert not (APP_ROOT / name).exists(), name


def test_if_user_readme_lists_seeded_logins():
    words = (APP_ROOT / "USER_README.md").read_text()
    for email, *_ in SEEDED:
        assert email in words
    assert PASSWORD in words


def test_if_reserved_directories_exist():
    for name in (".browser_screenshots", ".downloads"):
        d = APP_ROOT / name
        assert d.is_dir(), name
        assert not any(d.iterdir()), f"{name} is not empty"


NAMED_LIBRARIES = ["@nestjs/core", "@nestjs/common", "@nestjs/platform-express", "pg", "nodemailer", "bcryptjs",
                   "preact", "preact-iso", "@fontsource/inter", "@fontsource/jetbrains-mono"]
OPTIONAL_LIBRARIES = ["cookie-parser", "@nestjs/serve-static", "preact-render-to-string"]
FORBIDDEN = re.compile(r"^(redis|ioredis|mongodb|mongoose|mysql2?|sqlite3|better-sqlite3|bull|bullmq|amqplib|kafkajs|"
                       r"@aws-sdk/.*|aws-sdk|minio|stripe|passport.*|firebase.*|@sendgrid/.*|mailgun.*|postmark|"
                       r"@auth0/.*|next-auth|typeorm|prisma|@prisma/.*)$")


def test_if_named_libraries_only():
    pkg = json.loads((APP_ROOT / "package.json").read_text())
    deps = pkg.get("dependencies", {})
    dev = pkg.get("devDependencies", {})
    bundled = {"preact", "preact-iso", "@fontsource/inter", "@fontsource/jetbrains-mono"}
    for lib in NAMED_LIBRARIES:
        assert lib in deps or (lib in bundled and lib in dev), f"{lib} missing from package.json"
    assert "vite" in dev or "vite" in deps
    allowed = set(NAMED_LIBRARIES + OPTIONAL_LIBRARIES)
    for lib in list(allowed & set(deps)):
        for root in (Path(str(DEPLOYED_APP)), APP_ROOT):
            manifest = root / "node_modules" / lib / "package.json"
            if manifest.exists():
                meta = json.loads(manifest.read_text())
                allowed |= set(meta.get("dependencies", {})) | set(meta.get("peerDependencies", {}))
                break
    extra = sorted(set(deps) - allowed)
    assert not extra, f"runtime dependencies beyond the named libraries: {extra}"
    bad = sorted(n for n in set(deps) | set(dev) if FORBIDDEN.match(n))
    assert not bad, f"second provider packages: {bad}"


def test_if_app_logs_each_request():
    serve = json.loads((APP_ROOT / "run.json").read_text())["serve"]
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    env = dict(os.environ, PORT=str(port), APP_PORT=str(port), APP_PUBLIC_PORT=str(port))
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    try:
        base = f"http://127.0.0.1:{port}"
        end = time.monotonic() + COPY_BOOT_S
        while True:
            assert proc.poll() is None, "copy exited:\n" + Path(log.name).read_text()[-3000:]
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                    break
            assert time.monotonic() < end, "copy never became healthy:\n" + Path(log.name).read_text()[-3000:]
            pause(POLL_INTERVAL_S)
        httpx.get(base + "/api/plans", timeout=HTTP_TIMEOUT_S)
        httpx.get(base + "/api/models", timeout=HTTP_TIMEOUT_S)
        end = time.monotonic() + MAIL_DEADLINE_S
        while True:
            lines = Path(log.name).read_text().splitlines()
            if any("GET" in l and "/api/plans" in l for l in lines) and any("GET" in l and "/api/models" in l for l in lines):
                break
            assert time.monotonic() < end, "no request lines logged:\n" + "\n".join(lines[-40:])
            pause(POLL_INTERVAL_S)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT_S)
