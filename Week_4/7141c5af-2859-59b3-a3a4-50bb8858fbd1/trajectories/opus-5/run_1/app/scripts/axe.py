#!/usr/bin/env python3
"""Runs axe-core over every screen at 375 and 1280, closed and with its dialog
open, and checks the device-independence and motion rules. Verification only."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
AXE = Path("node_modules/axe-core/axe.min.js").read_text()
TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]

passed = 0
failed = []


def check(label, got, want):
    global passed
    if got == want:
        passed += 1
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")


def audit(page, label):
    page.add_script_tag(content=AXE)
    result = page.evaluate(
        """async (tags) => {
            const r = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
            return r.violations.map(v => ({ id: v.id, n: v.nodes.length,
              target: v.nodes[0] && v.nodes[0].target }));
        }""",
        TAGS,
    )
    check(f"axe {label}", result, [])


PUBLIC = ["/", "/work", "/work/bentwood-armchair", "/enquire", "/sign-in", "/sign-up"]

DESK = [
    ("/pieces", "#new-piece"),
    ("/pieces/1", None),
    ("/pieces/1/condition", "#add-a-pin"),
    ("/pieces/1/photographs", None),
    ("/pieces/1/hide", "#clear-hide"),
    ("/pieces/1/estimate", "#edit-estimate"),
    ("/pieces/1/collection", "#book-a-collection"),
    ("/pieces/6/dossier", None),
    ("/clients", "#new-client"),
    ("/clients/1", "#rename-client"),
    ("/library", None),
    ("/bench", "#add-job"),
    ("/workbook", None),
    ("/rates", "#new-rate"),
]


def sign_in(page):
    page.goto(f"{BASE}/sign-in")
    page.fill("#sign-in-email", "agnese@bottega-semenza.example")
    page.fill("#sign-in-password", "tacks-and-hide-2027")
    page.click("#sign-in-submit")
    page.wait_for_url(f"{BASE}/pieces")


def run(p):
    browser = p.chromium.launch()
    for width, height in [(1280, 800), (375, 812)]:
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        for path in PUBLIC:
            page.goto(BASE + path)
            page.wait_for_timeout(300)
            audit(page, f"{width} {path}")

        sign_in(page)
        for path, opener in DESK:
            page.goto(BASE + path)
            page.wait_for_timeout(900)
            audit(page, f"{width} {path}")
            if opener and page.locator(opener).count() > 0 and page.locator(opener).is_visible():
                page.click(opener)
                page.wait_for_timeout(600)
                if page.locator('[role="dialog"]').count() > 0:
                    audit(page, f"{width} {path} with its dialog open")
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(500)

        # the client page in each language
        answer = context.request.post(f"{BASE}/api/pieces/3/client-page", data={}).json()
        token = answer["clientPage"]["address"].rsplit("/", 1)[-1]
        page.goto(f"{BASE}/c/{token}")
        page.wait_for_timeout(400)
        audit(page, f"{width} client page")
        page.click("#your-answer")
        page.wait_for_timeout(600)
        audit(page, f"{width} client page with its sheet open")
        context.close()

    # SR14: the same address shows the same visible text whatever the browser's
    # language, zone and clock.
    plain = browser.new_context(viewport={"width": 1280, "height": 800})
    pp = plain.new_page()
    sign_in(pp)
    pp.goto(f"{BASE}/pieces/1/estimate")
    pp.wait_for_selector("#estimate-total")
    first = pp.inner_text("#main")
    plain.close()

    odd = browser.new_context(
        viewport={"width": 1280, "height": 800},
        locale="de-DE",
        timezone_id="Pacific/Auckland",
    )
    op = odd.new_page()
    op.add_init_script(
        """(() => {
          const shift = 3 * 24 * 60 * 60 * 1000;
          const RealDate = Date;
          const Shifted = new Proxy(RealDate, {
            construct(t, args) {
              return args.length === 0 ? new t(RealDate.now() + shift) : new t(...args);
            },
            apply() { return new RealDate(RealDate.now() + shift).toString(); },
          });
          Shifted.now = () => RealDate.now() + shift;
          Shifted.parse = RealDate.parse;
          Shifted.UTC = RealDate.UTC;
          window.Date = Shifted;
        })()"""
    )
    sign_in(op)
    op.goto(f"{BASE}/pieces/1/estimate")
    op.wait_for_selector("#estimate-total")
    second = op.inner_text("#main")
    check("SR14 same text with German, Auckland and a clock three days on", second, first)
    odd.close()

    # SR7: every motion runs for exactly 160, 320 or 640 ms.
    motion = browser.new_context(viewport={"width": 1280, "height": 800})
    mp = motion.new_page()
    mp.add_init_script(
        """(() => {
          window.__durations = [];
          const realAnimate = Element.prototype.animate;
          Element.prototype.animate = function (frames, options) {
            const d = typeof options === 'number' ? options : options && options.duration;
            window.__durations.push(d);
            return realAnimate.call(this, frames, options);
          };
        })()"""
    )
    sign_in(mp)
    mp.goto(f"{BASE}/work")
    mp.click("#work-button")
    mp.wait_for_timeout(400)
    mp.keyboard.press("Escape")
    mp.wait_for_timeout(400)
    mp.click("#kind-leather")
    mp.wait_for_timeout(400)
    mp.goto(f"{BASE}/pieces/1/hide")
    mp.wait_for_selector('[data-part="pattern-piece"]')
    mp.locator('[data-part="hide"]').focus()
    mp.keyboard.press("Enter")
    mp.wait_for_timeout(300)
    mp.keyboard.press("ArrowRight")
    mp.wait_for_timeout(250)
    mp.keyboard.press("r")
    mp.wait_for_timeout(400)
    mp.keyboard.press("Escape")
    mp.wait_for_timeout(400)
    mp.goto(f"{BASE}/pieces")
    mp.wait_for_timeout(700)
    mp.click("#change-password")
    mp.wait_for_timeout(400)
    mp.keyboard.press("Escape")
    mp.wait_for_timeout(500)
    durations = sorted(set(mp.evaluate("window.__durations")))
    check("SR7 only published durations", [d for d in durations if d not in (160, 320, 640)], [])
    check("SR7 motion did run", len(durations) > 0, True)
    check("no endless loop", mp.evaluate("document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity).length"), 0)
    motion.close()

    # Reduced motion shows each end state at once with the same function.
    reduced = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    rp = reduced.new_page()
    sign_in(rp)
    rp.goto(f"{BASE}/pieces/1/hide")
    rp.wait_for_selector('[data-part="pattern-piece"]')
    rp.locator('[data-part="hide"]').focus()
    rp.keyboard.press("Enter")
    rp.wait_for_timeout(100)
    check("reduced motion still lifts", rp.get_attribute('[data-piece="Seat"]', "data-state"), "lifted")
    check("reduced motion starts no animation", rp.evaluate("document.getAnimations().length"), 0)
    rp.goto(f"{BASE}/work")
    rp.click('[data-case-link="slat-bench"]')
    rp.wait_for_timeout(500)
    check("reduced motion does no shared move", rp.url, f"{BASE}/work/slat-bench")
    rp.goto(f"{BASE}/pieces")
    rp.wait_for_timeout(700)
    rp.click("#change-password")
    rp.wait_for_timeout(80)
    check("reduced motion opens the dialog at once", rp.locator('[role="dialog"]').is_visible(), True)
    rp.keyboard.press("Escape")
    rp.wait_for_timeout(100)
    check("reduced motion closes at once", rp.locator('[role="dialog"]').count(), 0)
    reduced.close()

    # SR16 with text spacing overridden, and SR15 at 320.
    spacing = browser.new_context(viewport={"width": 375, "height": 812})
    sp = spacing.new_page()
    sp.add_style_tag(
        content="* { line-height: 1.5 !important; letter-spacing: 0.12em !important;"
        " word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }"
    )
    sign_in(sp)
    for path in ["/pieces", "/library", "/bench", "/clients/7"]:
        sp.goto(BASE + path)
        sp.wait_for_timeout(800)
        clipped = sp.evaluate(
            """() => [...document.querySelectorAll('*')].filter(el => {
                 const s = getComputedStyle(el);
                 return s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
               }).length"""
        )
        check(f"SR16 no clipped text {path}", clipped, 0)
    spacing.close()

    narrow = browser.new_context(viewport={"width": 320, "height": 568})
    npg = narrow.new_page()
    sign_in(npg)
    for path in ["/pieces", "/clients", "/clients/7", "/library", "/bench", "/rates", "/workbook"]:
        npg.goto(BASE + path)
        npg.wait_for_timeout(800)
        over = npg.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check(f"SR15 no sideways scroll at 320 {path}", over, False)
    narrow.close()

    # SR17 at 812x375 an open sheet scrolls inside itself.
    short = browser.new_context(viewport={"width": 812, "height": 375})
    shp = short.new_page()
    sign_in(shp)
    shp.goto(f"{BASE}/pieces")
    shp.wait_for_timeout(700)
    shp.click("#new-piece")
    shp.wait_for_selector('[role="dialog"]')
    inside = shp.evaluate(
        """() => {
             const panel = document.querySelector('.dialog-panel');
             return getComputedStyle(panel).overflowY === 'auto' || getComputedStyle(panel).overflowY === 'scroll';
           }"""
    )
    check("SR17 the sheet scrolls inside itself", inside, True)
    short.close()

    browser.close()


with sync_playwright() as p:
    run(p)

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
