from __future__ import annotations

import base64
import json
import math
import os
import re
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Final, Literal
from urllib.parse import urlparse
from weakref import WeakKeyDictionary

import httpx
import pytest
from PIL import Image, UnidentifiedImageError
from playwright.sync_api import Browser, CDPSession, Locator, Page, expect, sync_playwright

HERE: Final = Path(__file__).parent
DEPLOYED_APP: Final = Path("/srv/app")
AXE: Final = Path("/opt/axe/node_modules/axe-core/axe.min.js")
CLOCK_START: Final = int(time.time())
CHROMIUM_ARGS: Final = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                 "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]


@pytest.fixture(scope="session")
def app_url() -> str:
    return os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173").rstrip("/")


@pytest.fixture(scope="session")
def browser() -> Iterator[Browser]:
    with sync_playwright() as driver, closing(driver.chromium.launch(headless=True, args=CHROMIUM_ARGS)) as instance:
        yield instance


@pytest.fixture
def page(browser: Browser, app_url: str, request: pytest.FixtureRequest) -> Iterator[Page]:
    options = getattr(request.module, "PAGE_OPTIONS", {}).get(request.node.originalname, {})
    with open_app(browser, app_url, **options) as tab:
        yield tab


def observe(page: Page) -> dict[str, Any]:
    return json.loads(page.evaluate("JSON.stringify(window.__VERIFIER_OBSERVE__())"))


@contextmanager
def open_app(
    browser: Browser,
    url: str,
    *,
    scale: float = 1,
    reduced_motion: Literal["reduce", "no-preference"] = "no-preference",
    no_webgl: bool = False,
) -> Iterator[Page]:
    with closing(
        browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=scale,
            has_touch=True,
            reduced_motion=reduced_motion,
            service_workers="block",
        )
    ) as context:
        context.add_init_script(path=HERE / "instrument.js")
        if no_webgl:
            context.add_init_script(
                "const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:original.call(this,kind,...args)}"
            )
        tab = context.new_page()
        tab.set_default_timeout(5000)
        tab.set_default_navigation_timeout(15000)
        now = int(time.time())
        tab.clock.install(time=now)
        tab.clock.pause_at(now + 10)
        tab.goto(url)
        yield tab


def advance(page: Page, milliseconds: float) -> None:
    remaining = round(milliseconds)
    while remaining > 0:
        step = min(16, remaining)
        page.clock.run_for(step)
        remaining -= step


def until(page: Page, script: str, arg: Any = None, seconds: float = 30) -> None:
    deadline = time.monotonic() + seconds
    while not page.evaluate(script, arg):
        if time.monotonic() > deadline:
            raise AssertionError(f"condition never held: {script}")
        advance(page, 48)


def stable_box(locator: Locator, seconds: float = 3.0) -> dict | None:
    deadline = time.monotonic() + seconds
    box = locator.bounding_box()
    while time.monotonic() < deadline:
        locator.page.wait_for_timeout(60)
        latest = locator.bounding_box()
        if box and latest and all(abs(box[k] - latest[k]) < 0.5 for k in ("x", "y", "width", "height")):
            return latest
        box = latest
    return box


def center(locator: Locator) -> tuple[float, float]:
    expect(locator).to_be_visible()
    expect(locator).to_be_enabled()
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    box = stable_box(locator)
    assert box is not None
    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    assert locator.evaluate(
        "(e,p) => {const hit=document.elementFromPoint(p.x,p.y);return hit===e||e.contains(hit)}",
        point,
    ), "control is obscured at the actual pointer target"
    return point["x"], point["y"]


def click(locator: Locator) -> None:
    locator.page.mouse.click(*center(locator))


def check(locator: Locator) -> None:
    if not locator.is_checked():
        click(locator)
    expect(locator).to_be_checked()


def tap(locator: Locator) -> None:
    locator.page.touchscreen.tap(*center(locator))


def fill(locator: Locator, value: str) -> None:
    click(locator)
    locator.fill(value)


def select(locator: Locator, choice: str) -> None:
    center(locator)
    locator.focus()
    picked = locator.evaluate(
        """(e, v) => {
            if (e.tagName !== 'SELECT') return null;
            const label = o => (o.label || o.text || '').trim();
            const o = [...e.options].find(o => label(o) === v) || [...e.options].find(o => o.value === v);
            if (!o) return [...e.options].map(label);
            e.value = o.value;
            e.dispatchEvent(new Event('input', {bubbles: true}));
            e.dispatchEvent(new Event('change', {bubbles: true}));
            return true;
        }""",
        choice,
    )
    if picked is None:
        locator.click()
        locator.page.get_by_role("option", name=choice, exact=True).first.click()
        if locator.evaluate("e => 'value' in e"):
            expect(locator).to_have_value(re.compile(re.escape(choice)))
        else:
            expect(locator).to_contain_text(choice)
        return
    assert picked is True, f"no option {choice!r} in the dropdown (options: {picked})"
    assert locator.evaluate(
        "(e, v) => [...e.selectedOptions].some(o => (o.label || o.text || '').trim() === v || o.value === v)", choice
    ), f"option {choice!r} is not selected"


SESSIONS: Final[WeakKeyDictionary[Page, CDPSession]] = WeakKeyDictionary()
TOUCHES: Final[WeakKeyDictionary[Page, dict[str, dict[str, float]]]] = WeakKeyDictionary()
TOUCH_IDS: Final[WeakKeyDictionary[Page, dict[str, int]]] = WeakKeyDictionary()


def session(page: Page) -> CDPSession:
    existing = SESSIONS.get(page)
    if existing is None:
        existing = SESSIONS[page] = page.context.new_cdp_session(page)
        page.once("close", lambda _: SESSIONS.pop(page, None))
    return existing


def pointer(page: Page, action: str, event: str = "pointerdown") -> None:
    active = TOUCHES.setdefault(page, {})
    ids = TOUCH_IDS.setdefault(page, {})
    box = page.get_by_test_id(f"touch-{action}").bounding_box()
    assert box
    if event == "pointerdown":
        active[action] = {
            "id": ids.setdefault(action, len(ids) + 1),
            "x": box["x"] + box["width"] / 2,
            "y": box["y"] + box["height"] / 2,
        }
    if event == "outside":
        active[action] = {"id": active[action]["id"], "x": 1, "y": 1}
    if event in ("pointerup", "pointercancel"):
        active.pop(action, None)
    kind = {"pointerdown": "touchStart", "pointerup": "touchEnd", "pointercancel": "touchCancel", "outside": "touchMove"}[event]
    session(page).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": list(active.values())})


@dataclass(frozen=True, slots=True)
class Pixels:
    width: int
    height: int
    rgb: bytes

    def variance(self) -> int:
        return max(self.rgb) - min(self.rgb)


def decode(payload: bytes) -> Pixels:
    if payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("expected browser PNG")
    try:
        with Image.open(BytesIO(payload)) as picture:
            rgb = picture.convert("RGB")
            return Pixels(rgb.width, rgb.height, rgb.tobytes())
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise AssertionError("malformed browser PNG") from error


def difference(before: Pixels, after: Pixels) -> float:
    assert (before.width, before.height) == (after.width, after.height), "capture size changed"
    return sum(abs(a - b) for a, b in zip(before.rgb, after.rgb, strict=True)) / len(before.rgb)


def capture(locator: Locator) -> bytes:
    expect(locator).to_be_visible()
    box = locator.bounding_box()
    assert box is not None
    page = locator.page
    viewport = page.viewport_size
    assert viewport is not None
    result = session(page).send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    payload = base64.b64decode(result["data"], validate=True)
    with Image.open(BytesIO(payload)) as pixels:
        size = (viewport["width"], viewport["height"])
        assert pixels.width >= size[0] and pixels.height >= size[1], "capture smaller than viewport"
        region = (
            max(0, math.floor(box["x"])),
            max(0, math.floor(box["y"])),
            min(size[0], math.floor(box["x"] + box["width"])),
            min(size[1], math.floor(box["y"] + box["height"])),
        )
        assert region[2] > region[0] and region[3] > region[1]
        output = BytesIO()
        pixels.resize(size, Image.Resampling.BOX).crop(region).save(output, format="PNG")
        return output.getvalue()


def changed(before: Pixels, after: Pixels, minimum: float = 0.15) -> None:
    assert difference(before, after) > minimum, "rendered canvas did not respond to input"


def axe(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """options => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__VERIFIER_AXE_RESULT__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,options).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        {"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]}},
    )
    for _ in range(625):
        status = page.evaluate("window.__VERIFIER_AXE_RESULT__()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"WCAG violations: {status['violations']}"
            return
        advance(page, 16)
    raise AssertionError("axe audit did not settle under controlled time")


def layout(page: Page) -> None:
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible():
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1


def motion(locator: Locator, duration_ms: float, samples: int = 12, settle_ms: float = 100) -> list[dict[str, float]]:
    if locator.evaluate("e => e.getAnimations({subtree: true}).length"):
        rects = seek_rects(locator.element_handle(), samples)
        return [{**rect, "t": duration_ms * i / max(1, len(rects) - 1)} for i, rect in enumerate(rects)]
    step, path = duration_ms / max(1, samples - 1), []
    for i in range(samples):
        if i:
            locator.page.clock.run_for(round(step))
        path.append({"t": step * i, **sample(locator)})
    locator.page.clock.run_for(round(settle_ms))
    return [*path, {"t": duration_ms + settle_ms, **sample(locator)}]


def sample(locator: Locator) -> dict[str, float]:
    return locator.evaluate("""e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width,
        height: r.height, opacity: Number(getComputedStyle(e).opacity)}; }""")


def scene_frames(canvas: Locator, steps: int = 4, step_ms: float = 500) -> list[dict[str, Any]]:
    page, frames = canvas.page, []
    for i in range(steps):
        if i:
            page.clock.run_for(round(step_ms))
        seen = observe(page)
        frames.append({"t": step_ms * i, "png": capture(canvas), "draws": seen["draws"], "matrices": seen["matrices"],
                       "uploaded": seen["uploaded"], "models": seen["models"]})
    return frames


def camera(page: Page) -> list[list[float]]:
    return observe(page)["matrices"]


def animations(locator: Locator) -> list[dict[str, Any]]:
    return locator.evaluate(
        """e => e.getAnimations({subtree: true}).map(a => ({
          name: a.animationName || a.transitionProperty || a.id || '', kind: a.constructor.name,
          duration: Number(a.effect?.getTiming().duration) || 0, easing: a.effect?.getTiming().easing || '',
          playState: a.playState}))"""
    )


SEEK: Final = """(e, n) => {
  const anims = e.getAnimations();
  if (!anims.length) return [];
  const end = a => a.effect.getComputedTiming().endTime;
  const a = anims.reduce((x, y) => (end(y) > end(x) ? y : x));
  const total = end(a), now = a.currentTime ?? 0, paused = a.playState === 'paused';
  a.pause();
  const out = [];
  for (let i = 0; i <= n; i++) {
    a.currentTime = total * i / n;
    const r = e.getBoundingClientRect();
    out.push({dt: (total * i / n - now) / 1000, x: r.left + r.width / 2, y: r.top + r.height / 2,
              top: r.top, bottom: r.bottom, w: r.width, h: r.height});
  }
  a.currentTime = now;
  if (!paused) a.play();
  return out;
}"""


def seek_rects(handle: Any, points: int = 24) -> list[dict[str, float]]:
    try:
        return handle.evaluate(SEEK, points) or []
    except Exception:
        return []


def settle(locator: Locator) -> None:
    locator.evaluate("e => e.getAnimations({subtree: true}).forEach(a => "
                     "{ if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); })")


def style(locator: Locator, *properties: str) -> dict[str, str]:
    return locator.evaluate("(e, ps) => { const s = getComputedStyle(e); return Object.fromEntries("
                            "ps.map(p => [p, s.getPropertyValue(p)])); }", list(properties))


def state_styles(locator: Locator, *properties: str, state: Literal["hover", "focus"] = "hover") -> tuple[dict, dict]:
    page = locator.page
    page.mouse.move(0, 0)
    settle(locator)
    before = style(locator, *properties)
    locator.hover() if state == "hover" else locator.focus()
    settle(locator)
    return before, style(locator, *properties)


def scroll_samples(page: Page, locator: Locator, positions: list[int], *properties: str) -> list[dict[str, str]]:
    samples = []
    for y in positions:
        page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", y)
        advance(page, 64)
        settle(locator)
        samples.append(style(locator, *properties))
    return samples


def tab_order(page: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(page.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return '';
          const text = n => (n?.textContent || '').replace(/\\s+/g, ' ').trim(), by = e.getAttribute('aria-labelledby');
          return (e.getAttribute('aria-label') || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : '')
                  || text(e.labels?.[0]) || text(e) || e.title || '').trim(); }"""))
    return names


@contextmanager
def held(page: Page, url_glob: str) -> Iterator[Any]:
    waiting: list = []

    def hold(route) -> None:
        waiting.append(route)

    page.route(url_glob, hold)

    def release() -> None:
        page.unroute(url_glob, hold)
        while waiting:
            waiting.pop(0).fallback()

    release.release = release
    try:
        yield release
    finally:
        release()


def unique(prefix: str = "visitor") -> tuple[str, str]:
    token = uuid.uuid4().hex[:10]
    return f"Ada {token}", f"{prefix}.{token}@example.com"


def idempotency_key() -> str:
    return f"verifier-{uuid.uuid4().hex}"


def post_json(base: str, path: str, body: Any, key: str | None = None, **headers: str) -> httpx.Response:
    sent = {"Content-Type": "application/json", **headers}
    if key is not None:
        sent["Idempotency-Key"] = key
    payload = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return httpx.post(f"{base}{path}", content=payload, headers=sent, timeout=60)


def same_origin(url: str, origin: str) -> bool:
    return urlparse(url).netloc in ("", urlparse(origin).netloc) or url.startswith(("data:", "blob:"))


@dataclass(frozen=True, order=True, slots=True)
class Package:
    name: str
    version: str
    licence: str


LICENCE_CLASSIFIERS: Final = {
    "MIT License": "MIT", "BSD License": "BSD-3-Clause", "ISC License (ISCL)": "ISC", "Apache Software License": "Apache-2.0",
    "The Unlicense (Unlicense)": "Unlicense", "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "Python Software Foundation License": "PSF-2.0", "MIT No Attribution License (MIT-0)": "MIT-0",
    "zlib/libpng License": "Zlib"}
VENV_TOOLS: Final = {"pip", "setuptools", "wheel"}


def shipped_packages(app: Path = DEPLOYED_APP) -> list[Package]:
    import importlib.metadata

    found: dict[tuple[str, str], Package] = {}
    sites = [str(p) for p in app.glob(".venv/lib/python*/site-packages")]
    assert sites or not any((app / f).is_file() for f in ("requirements.txt", "pyproject.toml", "uv.lock")), \
        "Python dependencies are declared but there is no installed .venv to read them from"
    for dist in importlib.metadata.distributions(path=sites):
        name, version = dist.metadata["Name"] or "", dist.metadata["Version"] or ""
        if name and re.sub(r"[-_.]+", "-", name.lower()) not in VENV_TOOLS:
            classifiers = [LICENCE_CLASSIFIERS.get(c.rsplit(" :: ", 1)[-1]) for c in dist.metadata.get_all("Classifier") or []
                           if c.startswith("License ::")]
            licence = (dist.metadata.get("License-Expression") or " OR ".join(c for c in classifiers if c)
                       or (dist.metadata.get("License") or "").strip())
            found[(name, version)] = Package(name, version, licence)
    for folder in project_dirs(app):
        for package in (*go_packages(folder), *cargo_packages(folder), *jvm_packages(folder)):
            found.setdefault((package.name, package.version), package)
    if not ((app / "package.json").is_file() or (app / "node_modules").is_dir()):
        return sorted(found.values())
    run = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=app, capture_output=True,
                         text=True, timeout=600)
    assert run.stdout.strip(), f"npm ls printed no tree (exit {run.returncode}): {run.stderr[-500:]}"

    def walk(node: dict[str, Any]) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            version, path = dep.get("version"), dep.get("path")
            if not version or dep.get("missing") or not path or not Path(path).is_dir() or (name, version) in found:
                continue
            found[(name, version)] = Package(name, version, _licence(dep, Path(path)))
            walk(dep)

    walk(json.loads(run.stdout))
    return sorted(found.values())


def _licence(dep: dict[str, Any], path: Path) -> str:
    value = dep.get("license") or dep.get("licenses")
    if not value and (path / "package.json").is_file():
        manifest = json.loads((path / "package.json").read_text())
        value = manifest.get("license") or manifest.get("licenses")
    if isinstance(value, list):
        return " OR ".join(str(v.get("type", "") if isinstance(v, dict) else v) for v in value)
    return str((value.get("type") if isinstance(value, dict) else value) or "")


APP_HOME: Final = Path("/home/app")
LICENCE_TEXTS: Final = (
    ("Apache-2.0", ("apache license", "version 2.0")), ("MPL-2.0", ("mozilla public license", "2.0")),
    ("BSD-3-Clause", ("redistribution and use in source and binary forms", "neither the name")),
    ("BSD-2-Clause", ("redistribution and use in source and binary forms",)),
    ("ISC", ("permission to use, copy, modify, and/or distribute this software",)),
    ("MIT", ("permission is hereby granted, free of charge",)),
    ("Unlicense", ("this is free and unencumbered software released into the public domain",)))
POM_LICENCES: Final = (
    ("Apache-2.0", r"apache.*2|apache-2\.0|licenses/license-2\.0"), ("MIT", r"\bmit\b"),
    ("BSD-3-Clause", r"bsd.*3|new bsd|revised bsd|eclipse distribution license|\bedl\b"), ("BSD-2-Clause", r"bsd.*2|simplified bsd"),
    ("EPL-2.0", r"eclipse public license.*2|epl-2\.0"), ("EPL-1.0", r"eclipse public license.*1|epl-1\.0"),
    ("MPL-2.0", r"mozilla public license.*2"), ("CDDL-1.1", r"cddl.*1\.1|common development and distribution.*1\.1"),
    ("GPL-2.0-only WITH Classpath-exception-2.0", r"gpl.*classpath|classpath exception"),
    ("LGPL-2.1-or-later", r"lgpl.*2\.1|lesser general public license.*2\.1"), ("Unlicense", r"unlicense"),
    ("CC0-1.0", r"cc0|public domain"))


APP_UID: Final = 10001
SUBMISSION_SKIP: Final = {"node_modules", ".venv", ".git", "target", "dist", "build", "vendor"}


def _toolchain(argv: list[str], app: Path, home: Path | None, env: dict[str, str]) -> str:
    base = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(home)} if home else dict(os.environ)
    drop = ["setpriv", f"--reuid={APP_UID}", f"--regid={APP_UID}", "--clear-groups", "--no-new-privs", "--"] \
        if home and os.geteuid() == 0 else []
    run = subprocess.run([*drop, *argv], cwd=app, capture_output=True, text=True, timeout=600, env={**base, **env})
    assert run.returncode == 0, f"{' '.join(argv[:3])} exit {run.returncode}: {(run.stderr or run.stdout)[-500:]}"
    return run.stdout


def project_dirs(app: Path) -> list[Path]:
    return [app, *sorted(d for d in app.iterdir() if d.is_dir() and not d.name.startswith(".")
                         and d.name not in SUBMISSION_SKIP)] if app.is_dir() else []


def licence_from_text(folder: Path) -> str:
    found = []
    for path in sorted(folder.glob("*")):
        if path.is_file() and re.match(r"(?i)(un)?licen[cs]e|copying", path.name):
            text = " ".join(path.read_text(errors="replace").lower().split())
            spdx = next((i for i, phrases in LICENCE_TEXTS if all(p in text for p in phrases)), "")
            if spdx and spdx not in found:
                found.append(spdx)
    return " OR ".join(found)


def go_packages(app: Path, home: Path | None = APP_HOME) -> list[Package]:
    if not (app / "go.mod").is_file():
        return []
    vendored = (app / "vendor" / "modules.txt").is_file()
    out = _toolchain(["go", "list", "-deps", "-f",
                      "{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}", "./..."], app,
                     home, {"GOFLAGS": "-mod=vendor" if vendored else "-mod=readonly", "GOWORK": "off",
                            **({"GOPROXY": "off", "GOTOOLCHAIN": "local", "GOCACHE": "/tmp/gf-go-cache",
                                "GOMODCACHE": str(home / "go" / "pkg" / "mod")} if home else {})})
    rows = {tuple(line.split("\t")) for line in out.splitlines() if line.count("\t") == 2}
    return [Package(path, version, licence_from_text(Path(folder) if folder else app / "vendor" / path))
            for path, version, folder in rows]


def cargo_packages(app: Path, home: Path | None = APP_HOME) -> list[Package]:
    if not (app / "Cargo.toml").is_file():
        return []
    cargo_home = home / ".cargo" if home else Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    offline = ["--offline"] if home else []
    out = _toolchain(["cargo", "tree", "-e", "normal", "--prefix", "none", "--no-dedupe", "--locked", *offline,
                      "-f", "{p}|{l}"], app, home, {"CARGO_HOME": str(cargo_home)} if home else {})
    found = {}
    for line in out.splitlines():
        crate, _, licence = line.partition("|")
        match = re.fullmatch(r"(\S+) v(\S+)(?: \((.*)\))?(?: \(\*\))?", crate.strip())
        if not match or (match[3] and not match[3].startswith(("registry+", "http", "git+", "sparse+"))
                         and "#" not in match[3]):
            continue
        name, version = match[1], match[2]
        if not licence.strip():
            licence = next((licence_from_text(d) for d in sorted((cargo_home / "registry" / "src").glob(f"*/{name}-{version}"))),
                           "")
        found[(name, version)] = Package(name, version, re.sub(r"\s*/\s*", " OR ", licence.strip()))
    return list(found.values())


def pom_licence(locate: Callable[[str, str, str], Path], group: str, artifact: str, version: str) -> str:
    import xml.etree.ElementTree as ET

    def child(element: Any, name: str) -> Any:
        return next((c for c in element if c.tag.rsplit("}", 1)[-1] == name), None)

    for _ in range(10):
        pom = locate(group, artifact, version)
        if not pom.is_file():
            return ""
        root = ET.parse(pom).getroot()
        licences = child(root, "licenses")
        if licences is not None and len(licences):
            ids = []
            for item in licences:
                words = " ".join(getattr(child(item, key), "text", None) or "" for key in ("name", "url")).lower()
                spdx = next((i for i, pattern in POM_LICENCES if re.search(pattern, words)), words.strip())
                if spdx and spdx not in ids:
                    ids.append(spdx)
            return " OR ".join(ids)
        parent = child(root, "parent")
        if parent is None:
            return ""
        group, artifact, version = (getattr(child(parent, k), "text", None) or "" for k in ("groupId", "artifactId", "version"))
    return ""


def jvm_packages(app: Path, home: Path | None = APP_HOME) -> list[Package]:
    if (app / "pom.xml").is_file():
        repository = (home or Path.home()) / ".m2" / "repository"
        listing = Path(tempfile.mkdtemp(prefix="gf-mvn-")) / "deps.txt"
        if home and os.geteuid() == 0:
            os.chown(listing.parent, APP_UID, APP_UID)
        offline = ["-o", "-Dmaven.repo.local.tail=/opt/m2-tools"] if home else []
        _toolchain(["mvn", "-B", "-q", *offline, f"-Dmaven.repo.local={repository}",
                    "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:list", "-DincludeScope=runtime",
                    f"-DoutputFile={listing}", "-DappendOutput=false"], app, home, {})
        line = re.compile(r"\s*([\w.\-]+):([\w.\-]+):[\w\-]+(?::[\w.\-]+)?:([\w.\-]+):(?:compile|runtime)\b")
        coords = {m.groups() for text in listing.read_text().splitlines() if (m := line.match(text))}

        def locate(g: str, a: str, v: str) -> Path:
            return repository.joinpath(*g.split("."), a, v, f"{a}-{v}.pom")
    elif gradle := next((f for f in ("build.gradle.kts", "build.gradle") if (app / f).is_file()), None):
        assert (app / "gradlew").is_file(), f"{gradle} without the Gradle wrapper: the images ship no system Gradle"
        gradle_home = (home or Path(os.environ.get("GRADLE_USER_HOME", Path.home() / ".gradle"))) / (".gradle" if home else "")
        out = _toolchain(["sh", "./gradlew", "-q", "--offline", "dependencies", "--configuration", "runtimeClasspath"],
                         app, home, {"GRADLE_USER_HOME": str(gradle_home)})
        tree = re.compile(r"--- ([\w.\-]+):([\w.\-]+):([\w.\-]+)(?: -> ([\w.\-]+))?")
        coords = {(m[1], m[2], m[4] or m[3]) for text in out.splitlines() if (m := tree.search(text))}
        cache = gradle_home / "caches" / "modules-2" / "files-2.1"

        def locate(g: str, a: str, v: str) -> Path:
            return next(iter(sorted(cache.joinpath(g, a, v).glob(f"*/{a}-{v}.pom"))), cache / "missing.pom")
    else:
        return []
    return [Package(f"{g}:{a}", v, pom_licence(locate, g, a, v)) for g, a, v in coords]


def pdf_text(data: bytes) -> str:
    run = subprocess.run(["pdftotext", "-layout", "-", "-"], input=data, capture_output=True, timeout=60)
    assert run.returncode == 0, f"pdftotext exit {run.returncode}: {run.stderr[-300:]!r}"
    return run.stdout.decode("utf-8", "replace")


def licence_allowed(expression: str, allowed: set[str]) -> bool:
    ids = [t for t in re.findall(r"[A-Za-z0-9.+\-]+", re.sub(r"\bWITH\s+[\w.+\-]+", "", expression))
           if t not in ("OR", "AND")]
    return bool(ids) and (all if re.search(r"\bAND\b", expression) else any)(i in allowed for i in ids)


import json
import os
import subprocess
from urllib.parse import unquote, urlsplit


class Postgres:

    def __init__(self, suffix: str = "") -> None:
        url = urlsplit(os.environ["POSTGRES_OBSERVER_URL"])
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": url.hostname or "",
                    "PGPORT": str(url.port or 5432), "PGDATABASE": url.path.lstrip("/") + suffix,
                    "PGUSER": unquote(url.username or ""), "PGPASSWORD": unquote(url.password or "")}

    def rows(self, sql: str) -> list[dict]:
        wrapped = f"SELECT coalesce(json_agg(q), '[]') FROM ({sql}) q"
        result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
                                env=self.env, capture_output=True, text=True, timeout=30, check=False)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    def tables(self) -> list[str]:
        return [r["t"] for r in self.rows(
            "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables "
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1")]


import datetime
import hashlib
import hmac
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


class S3:

    def __init__(self, suffix: str = "") -> None:
        self.endpoint, self.region = os.environ["S3_ENDPOINT"].rstrip("/"), os.environ["S3_REGION"]
        self.bucket = os.environ["S3_BUCKET"] + suffix
        self.key_id, self.secret = os.environ["S3_ACCESS_KEY_ID"], os.environ["S3_SECRET_ACCESS_KEY"]

    def _get(self, path: str, query: dict[str, str] | None = None) -> tuple[int, bytes]:
        now = datetime.datetime.now(datetime.UTC)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        qs = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
                      for k, v in sorted((query or {}).items()))
        payload = hashlib.sha256(b"").hexdigest()
        headers = {"host": urllib.parse.urlsplit(self.endpoint).netloc, "x-amz-content-sha256": payload,
                   "x-amz-date": amz_date}
        signed, scope = ";".join(headers), f"{day}/{self.region}/s3/aws4_request"
        canonical = "\n".join(["GET", urllib.parse.quote(path), qs,
                               "".join(f"{k}:{v}\n" for k, v in headers.items()), signed, payload])
        to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        key = f"AWS4{self.secret}".encode()
        for part in (day, self.region, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        sig = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, "
                                    f"SignedHeaders={signed}, Signature={sig}")
        url = self.endpoint + urllib.parse.quote(path) + (f"?{qs}" if qs else "")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def keys(self, prefix: str = "") -> list[str]:
        status, body = self._get(f"/{self.bucket}", {"list-type": "2", "prefix": prefix})
        assert status == 200, body
        return sorted(n.text or "" for n in ET.fromstring(body).iter() if n.tag.endswith("}Key"))

    def get(self, key: str) -> bytes:
        status, body = self._get(f"/{self.bucket}/{key}")
        assert status == 200, f"GET {key}: {status}"
        return body


import os
import socket
import urllib.parse
from typing import Any

import pytest


class Valkey:

    def __init__(self) -> None:
        url = urllib.parse.urlsplit(os.environ["VALKEY_OBSERVER_URL"])
        self.address = (url.hostname, url.port or 6379)
        self.auth = (urllib.parse.unquote(url.username or "default"), urllib.parse.unquote(url.password or ""))
        self.db = int(url.path.lstrip("/") or 0)

    def command(self, *args: Any) -> Any:
        with socket.create_connection(self.address, timeout=10) as sock:
            stream = sock.makefile("rb")
            replies = [self._call(sock, stream, "AUTH", *self.auth), self._call(sock, stream, "SELECT", self.db)]
            replies.append(self._call(sock, stream, *args))
            return replies[-1]

    def keys(self, pattern: str = "*") -> list[str]:
        cursor, found = "0", set()
        while True:
            cursor, batch = self.command("SCAN", cursor, "MATCH", pattern, "COUNT", 500)
            found.update(batch)
            if cursor == "0":
                return sorted(found)

    def hash(self, key: str) -> dict[str, str]:
        flat = self.command("HGETALL", key)
        return dict(zip(flat[::2], flat[1::2]))

    def members(self, key: str) -> list[str]:
        return sorted(self.command("SMEMBERS", key))

    def items(self, key: str) -> list[str]:
        return self.command("LRANGE", key, 0, -1)

    def ttl(self, key: str) -> int:
        return self.command("TTL", key)

    @classmethod
    def _call(cls, sock: socket.socket, stream: Any, *args: Any) -> Any:
        parts = [str(arg).encode() for arg in args]
        sock.sendall(f"*{len(parts)}\r\n".encode() + b"".join(b"$%d\r\n%s\r\n" % (len(p), p) for p in parts))
        return cls._reply(stream)

    @classmethod
    def _reply(cls, stream: Any) -> Any:
        line = stream.readline()
        kind, rest = line[:1], line[1:-2]
        if kind == b"-":
            raise AssertionError(f"Valkey observer: {rest.decode()}")
        if kind == b"+":
            return rest.decode()
        if kind == b":":
            return int(rest)
        if kind == b"$":
            return None if int(rest) < 0 else stream.read(int(rest) + 2)[:-2].decode("utf-8", "replace")
        if kind == b"*":
            return None if int(rest) < 0 else [cls._reply(stream) for _ in range(int(rest))]
        raise AssertionError(f"Valkey observer: unexpected reply {line[:40]!r}")


@pytest.fixture
def valkey() -> Valkey:
    return Valkey()


import os
import time
from typing import Any

import httpx
import pytest


def mail_from_address() -> str:
    value = os.environ["MAIL_FROM"]
    return value[value.index("<") + 1 : value.index(">")] if "<" in value else value.strip()


class Mailpit:
    def __init__(self) -> None:
        self.client = httpx.Client(base_url=os.environ["MAILPIT_URL"].rstrip("/"), timeout=15)

    def clear(self) -> None:
        assert self.client.delete("/api/v1/messages").status_code == 200

    def messages(self, expected: int = 0, settle: float = 1.5) -> list[dict[str, Any]]:
        deadline = time.monotonic() + 15
        while len(summaries := self.client.get("/api/v1/messages", params={"limit": 200}).json()["messages"]) < expected:
            if time.monotonic() > deadline:
                break
            time.sleep(0.25)
        time.sleep(settle)
        summaries = self.client.get("/api/v1/messages", params={"limit": 200}).json()["messages"]
        return [self.client.get(f"/api/v1/message/{item['ID']}").json() for item in summaries]


def addresses(field: Any) -> list[str]:
    items = field if isinstance(field, list) else [field] if field else []
    return [item["Address"].lower() for item in items]


def text(message: dict[str, Any]) -> str:
    return message["Text"].replace("\r\n", "\n")


@pytest.fixture
def mail() -> Mailpit:
    mailpit = Mailpit()
    mailpit.clear()
    return mailpit
