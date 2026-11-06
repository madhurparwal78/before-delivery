# Layout, keyboard, reduced-motion and a11y checks in the browser.
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
results = []

def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + ((' :: ' + str(detail)[:300]) if detail and not ok else ''))

def no_horizontal_scroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

def sign_in(page, email):
    page.evaluate("fetch('/api/session', {method: 'DELETE'}).catch(() => {})")
    page.goto(BASE + '/signin')
    page.wait_for_selector('input#email')
    page.fill('input#email', email)
    page.fill('input#passcode', 'weave-demo-2026')
    page.click('button:has-text("Sign in")')

def board_sizes(page):
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    for (w, hname) in [(1280, 'wide'), (768, 'tablet'), (375, 'phone')]:
        page.set_viewport_size({'width': w, 'height': 812})
        page.wait_for_timeout(500)
        check(f'board has no horizontal overflow at {w}px', no_horizontal_scroll(page))
    page.set_viewport_size({'width': 1280, 'height': 800})
    # Three columns on wide screens.
    boxes = page.locator('.board-rail').bounding_box()
    centre = page.locator('#requests-region').bounding_box()
    detail = page.locator('section[aria-label="Request detail"]').bounding_box()
    check('wide board has three side-by-side columns',
          boxes and centre and detail and boxes['x'] < centre['x'] < detail['x'])
    # Tabs on narrow screens.
    page.set_viewport_size({'width': 375, 'height': 812})
    page.wait_for_timeout(400)
    tabs = page.locator('[role="tablist"][aria-label="Board views"]')
    check('narrow board shows the tab bar', tabs.count() == 1)
    rail = page.locator('.board-rail')
    rail_box = rail.bounding_box()
    viewport_h = page.evaluate('window.innerHeight')
    check('interpreter strip pinned to the bottom',
          rail_box and rail_box['y'] + rail_box['height'] > viewport_h - 90,
          rail_box)
    check('narrow board has no horizontal page overflow', no_horizontal_scroll(page))
    # The strip scrolls sideways inside itself.
    strip_scrolls = page.evaluate('''() => {
      const rail = document.querySelector('.board-rail');
      const list = document.querySelector('.board-rail ul');
      return (rail && rail.scrollWidth > rail.clientWidth) || (list && list.scrollWidth > list.clientWidth);
    }''')
    check('interpreter strip scrolls sideways inside itself', bool(strip_scrolls))
    page.set_viewport_size({'width': 1280, 'height': 800})

def other_screens_sizes(page):
    for email, path, marker in [
        ('joel@birchmere.test', '/requests', 'table[aria-label="Requests"]'),
        ('joel@birchmere.test', '/requests/new', 'form[aria-label="New request"]'),
        ('imani@interpreters.test', '/me', 'section[aria-label="My offers"]'),
        ('marcus@consumers.test', '/preferences', 'table[aria-label="Interpreter preferences"]'),
        ('marguerite@fernhollow.test', '/billing', 'table[aria-label="Timesheets awaiting approval"]'),
    ]:
        sign_in(page, email)
        page.goto(BASE + path)
        page.wait_for_selector(marker, timeout=8000)
        for w in [375, 768, 1280]:
            page.set_viewport_size({'width': w, 'height': 812})
            page.wait_for_timeout(400)
            check(f'{path} has no horizontal overflow at {w}px', no_horizontal_scroll(page), path)
        page.set_viewport_size({'width': 1280, 'height': 800})

def keyboard_matching(page):
    page.set_viewport_size({'width': 1280, 'height': 800})
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('button.chip')
    # Keyboard: Enter picks up the chip, focus moves to the first card.
    page.locator('button.chip', has_text='Dana Okafor').focus()
    page.keyboard.press('Enter')
    first_card = page.locator('article[data-request-id]').first
    check('Enter on a chip picks it up and focuses the first card',
          page.evaluate('document.activeElement?.dataset.requestId !== undefined')
          and page.evaluate('document.activeElement?.getAttribute("aria-label")') == first_card.get_attribute('aria-label'))
    pressed = page.locator('button.chip', has_text='Dana Okafor').get_attribute('aria-pressed')
    check('picked chip has aria-pressed true', pressed == 'true')
    # Arrow down moves focus to the next card and announces the gates.
    fa1002_index = page.evaluate('''() => {
      const cards = [...document.querySelectorAll('article[data-request-id]')];
      return cards.findIndex(c => c.textContent.includes('FA-1002'));
    }''')
    for _ in range(fa1002_index):
        page.keyboard.press('ArrowDown')
    page.wait_for_timeout(1200)
    gate_status = page.evaluate('''() => {
      const el = [...document.querySelectorAll('.status-region')].find(s => s.getAttribute('aria-label') === 'Gate results');
      return el?.textContent ?? '';
    }''')
    check('gate results announced in the live region',
          'FA-1002 seat 1: Credential' in gate_status, gate_status)
    # Enter commits the focused card.
    page.keyboard.press('Enter')
    page.wait_for_selector('text=Offered FA-1002 seat 1 to Dana Okafor', timeout=8000)
    check('Enter on the focused card pins', True)
    # Focus returns to the chip after the commit.
    page.wait_for_timeout(800)
    check('focus returns to the chip', page.evaluate(
        'document.activeElement?.classList.contains("chip") === true'))
    # Escape drops the chip without committing.
    page.locator('button.chip', has_text='Theo Marchetti').focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    check('Escape drops the chip without committing',
          page.locator('button.chip', has_text='Theo Marchetti').get_attribute('aria-pressed') == 'false')

def reduced_motion(page):
    page.set_viewport_size({'width': 1280, 'height': 800})
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    # Reduced motion: all four pips change at once (no stagger).
    page.emulate_media(reduced_motion='reduce')
    fa1002 = page.locator('article', has_text='FA-1002').first
    chip = page.locator('button.chip', has_text='Imani Brooks')
    cb = chip.bounding_box()
    bx = fa1002.bounding_box()
    page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2)
    page.mouse.down()
    page.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + 40, steps=6)
    page.wait_for_timeout(700)
    # All four pips resolve at once: no pip is still faded out.
    faded = page.evaluate('''() => {
      const card = [...document.querySelectorAll('article')].find(c => c.textContent.includes('FA-1002'));
      return [...card.querySelectorAll('.pip')].some(p => p.style.opacity === '0');
    }''')
    check('reduced motion resolves pips without stagger', not faded)
    page.mouse.up()
    page.wait_for_timeout(600)
    # The recoil removes the thread at once.
    thread_gone = page.evaluate("document.querySelector('.thread-canvas').style.display === 'none'")
    check('reduced motion removes the thread at once', thread_gone)
    page.emulate_media(reduced_motion='no-preference')

def live_regions(page):
    sign_in(page, 'joel@birchmere.test')
    page.wait_for_selector('table[aria-label="Requests"]')
    check('service status banner present', page.locator('[aria-label="Service status"]').count() >= 1)
    check('main navigation present', page.locator('nav[aria-label="Main"]').count() == 1)
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    check('board status region present', page.locator('[aria-label="Board status"]').count() >= 1)
    check('gate results region present', page.locator('[aria-label="Gate results"]').count() >= 1)
    check('skip link present', page.locator('a:has-text("Skip to requests")').count() == 1)
    check('interpreter list labelled', page.locator('ul[aria-label="Interpreters"]').count() == 1)
    check('requests region labelled', page.locator('#requests-region').count() == 1)
    # Pips carry state in their accessible names.
    fa1001 = page.locator('article', has_text='FA-1001').first
    gate_list = fa1001.locator('ul[aria-label^="Gates for FA-1001"]')
    check('gate list is named Gates for <ref>', gate_list.count() == 1)
    check('seat button named Seat <i> of <k> for <ref>',
          page.locator('button[aria-label="Seat 1 of 1 for FA-1001"]').count() == 1)

def visual_identity(page):
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    body_bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check('warm paper ground', body_bg == 'rgb(247, 243, 234)', body_bg)
    h1_font = page.evaluate("getComputedStyle(document.querySelector('.brand')).fontFamily")
    check('serif display type', 'Instrument Serif' in h1_font, h1_font)
    mono = page.evaluate("getComputedStyle(document.querySelector('.mono')).fontFamily")
    check('monospaced times', 'IBM Plex Mono' in mono, mono)
    shadow = page.evaluate("getComputedStyle(document.querySelector('article')).boxShadow")
    check('flat surfaces with no shadow', shadow == 'none', shadow)
    # Vermilion only for failing gates and in-window markers.
    vermilion = page.evaluate('''() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a, .btn')) {
        const c = getComputedStyle(el).color;
        if (c === 'rgb(191, 53, 18)') bad.push(el.outerHTML.slice(0, 60));
      }
      return bad;
    }''')
    check('vermilion never used for buttons or links', len(vermilion) == 0, vermilion)
    # Focus outline is a solid ink outline.
    page.locator('button.chip').first.focus()
    outline = page.evaluate("getComputedStyle(document.activeElement).outlineWidth")
    check('focus outline at least two pixels', float(outline.replace('px', '')) >= 2, outline)
    # Controls are at least 44 pixels tall.
    heights = page.evaluate('''() => {
      const bad = [];
      for (const el of document.querySelectorAll('button')) {
        if (el.offsetParent === null || el.closest('[hidden]')) continue;
        const h = el.getBoundingClientRect().height;
        if (h < 43) bad.push([el.textContent.trim().slice(0, 20), h]);
      }
      return bad;
    }''')
    check('controls at least 44 pixels tall', len(heights) == 0, heights)

def run(page):
    board_sizes(page)
    other_screens_sizes(page)
    keyboard_matching(page)
    reduced_motion(page)
    live_regions(page)
    visual_identity(page)
    print()
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)}/{len(results)} checks passed')
    if fails:
        sys.exit(1)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    try:
        run(page)
    finally:
        browser.close()
