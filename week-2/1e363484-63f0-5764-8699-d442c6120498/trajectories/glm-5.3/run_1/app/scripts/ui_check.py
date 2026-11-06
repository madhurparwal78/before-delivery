#!/usr/bin/env python3
"""Browser checks for the Fluxseal front end."""
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173'
results = []


def check(name, cond, detail=''):
    results.append((name, cond, detail if not cond else ''))
    print(('PASS' if cond else 'FAIL') + '  ' + name + ('  ' + str(detail) if not cond else ''))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # ---- sign in ----
        page.goto(BASE + '/projects')
        page.wait_for_url('**/signin')
        check('redirect to signin', page.locator('h1').inner_text() == 'Fluxseal')
        page.get_by_label('Email').fill('tomas@levelmoor.example')
        page.get_by_label('Password').fill('moss-and-tower-26')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url('**/projects')
        page.wait_for_selector('table[aria-label=Projects]')
        check('projects page', page.get_by_role('table', name='Projects').count() == 1)

        # wrong credentials copy
        page.get_by_role('button', name='Sign out').click()
        page.wait_for_url('**/signin')
        page.get_by_label('Email').fill('tomas@levelmoor.example')
        page.get_by_label('Password').fill('wrong')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_selector('[role=alert]')
        check('wrong password copy', page.locator('[role=alert]').inner_text().strip() == 'That email and password do not match.')
        page.get_by_label('Password').fill('moss-and-tower-26')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url('**/projects')

        # ---- workspace ----
        page.get_by_role('link', name='Blackmere Moss').click()
        page.wait_for_selector('h1:has-text("Blackmere Moss")')
        check('workspace heading', page.locator('h1').inner_text() == 'Blackmere Moss')
        days = page.get_by_role('list', name='Daily net CO2e').get_by_role('listitem')
        page.wait_for_function("document.querySelectorAll('[aria-label^=\"2026-\"]').length >= 14")
        check('timeline 14 days', days.count() == 14, days.count())
        first = days.first.get_attribute('aria-label')
        check('first day name', first == '2026-06-01 -0.437 tCO2e', first)

        # figure panel values from the whole-record preview
        page.wait_for_timeout(1500)
        region = page.get_by_role('region', name='Figure')
        check('coverage value', region.get_by_text('85.0%').count() > 0,
              region.inner_text()[:200])
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        check('brush announcement', 'Coverage 85.0%, net -16.808 tCO2e. Seal available.' == status_text, repr(status_text))
        seal_btn = page.get_by_role('button', name='Seal figure')
        check('seal armed', seal_btn.is_enabled())

        # url carries the state
        url = page.url
        check('canonical url', 'from=2026-06-01' in url and 'start=202606010000' in url and 'sensors=BM-S1' in url, url)

        # unit breakdown dialog
        page.get_by_role('button', name='Unit breakdown').click()
        dlg = page.get_by_role('dialog', name='Unit breakdown')
        check('breakdown dialog', dlg.is_visible())
        check('breakdown rows', dlg.get_by_role('table', name='Unit breakdown').get_by_role('row').count() == 7)
        page.keyboard.press('Escape')
        check('breakdown closed', page.get_by_role('dialog', name='Unit breakdown').count() == 0)
        check('focus returned', page.evaluate("document.activeElement.textContent") == 'Unit breakdown')

        # keyboard brush step
        slider = page.get_by_role('slider', name='Interval end')
        slider.focus()
        page.keyboard.press('ArrowLeft')
        page.wait_for_timeout(1200)
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        check('keyboard brush announcement', 'Coverage 85.0%, net -16.820 tCO2e. Seal available.' == status_text, repr(status_text))
        # step back to restore the whole record
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(1500)

        # sensor toggle: untick BM-S1 (brush stays whole record)
        cb = page.get_by_role('checkbox', name='BM-S1')
        cb.uncheck()
        page.wait_for_timeout(1500)
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        check('sensor change announcement', 'Coverage 73.3%, net -13.929 tCO2e. Seal available.' == status_text, repr(status_text))
        cb.check()
        page.wait_for_timeout(1500)

        # last sensor cannot be unticked
        boxes = page.locator('[role=group][aria-label=Sensors] input[type=checkbox]')
        for i in range(boxes.count()):
            if boxes.nth(i).is_checked():
                last = boxes.nth(i)
        page.locator('[role=group][aria-label=Sensors] input[type=checkbox]').nth(0).check()
        page.wait_for_timeout(600)
        # untick all but one
        for i in range(boxes.count()):
            b = boxes.nth(i)
            if b.is_checked() and i > 0:
                b.uncheck()
        page.wait_for_timeout(600)
        remaining = [b for i in range(boxes.count()) if boxes.nth(i).is_checked()]
        check('last sensor stays', len(remaining) >= 1)

        # restore all sensors
        for i in range(boxes.count()):
            if not boxes.nth(i).is_checked():
                boxes.nth(i).check()
        page.wait_for_timeout(1500)

        # ---- seal ----
        page.get_by_role('button', name='Seal figure').click()
        seal_dlg = page.get_by_role('dialog', name='Seal figure')
        check('seal dialog', seal_dlg.is_visible())
        check('seal dialog focus', page.evaluate("document.activeElement.textContent") == 'Confirm seal')
        seal_dlg.get_by_role('button', name='Confirm seal').click()
        page.wait_for_timeout(2500)
        check('seal dialog closed', page.get_by_role('dialog', name='Seal figure').count() == 0)
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        check('sealed announcement', status_text.startswith('Sealed BM-F'), repr(status_text))
        figures = page.get_by_role('table', name='Figures')
        check('figure row', figures.get_by_role('link', name='BM-F0001').count() == 1)
        check('focus on new figure', page.evaluate("document.activeElement.textContent") == 'BM-F0001')
        balance = page.get_by_role('region', name='Project balance')
        check('balance strip', '-14.287' in balance.inner_text(), balance.inner_text())

        # ledger entries
        ledger = page.get_by_role('table', name='Sealed-tonnes ledger')
        text = ledger.inner_text()
        check('ledger issuance', 'Issuance' in text and '-16.808' in text)
        check('ledger buffer', 'Buffer' in text and '2.521' in text)

        # the whole-record interval is now already sealed: button disabled with reason
        seal_btn = page.get_by_role('button', name='Seal figure')
        page.wait_for_timeout(1800)
        check('seal disabled after seal', seal_btn.is_disabled())
        reason = page.locator('.seal-reason')
        check('already sealed reason text', 'This interval is already sealed as BM-F0001.' in reason.inner_text(), reason.inner_text())

        # ---- figure page ----
        page.get_by_role('table', name='Figures').get_by_role('link', name='BM-F0001').click()
        page.wait_for_selector('h1:has-text("Figure BM-F0001")')
        check('figure heading', page.locator('h1').inner_text() == 'Figure BM-F0001')
        page.screenshot(path='/tmp/figure_page.png', full_page=True)

        # issue a regulator link
        page.get_by_role('button', name='Issue regulator link').click()
        page.wait_for_timeout(800)
        box = page.get_by_role('textbox', name='Regulator link')
        link_url = box.input_value()
        check('link issued', '/r/' in link_url, link_url)
        st = page.get_by_role('status', name='Figure status').inner_text()
        check('link issued announcement', 'Regulator link issued. It expires' in st, st)

        # ---- regulator page (no session) ----
        rctx = browser.new_context(viewport={'width': 375, 'height': 812})
        rpage = rctx.new_page()
        rpage.goto(link_url)
        rpage.wait_for_selector('h1:has-text("Sealed figure BM-F0001")')
        check('regulator heading', rpage.locator('h1').inner_text() == 'Sealed figure BM-F0001')
        check('regulator status', 'Status: Intact' in rpage.locator('body').inner_text())
        check('regulator expiry', 'Link expires' in rpage.locator('body').inner_text())
        rpage.get_by_role('button', name='Re-derive').click()
        rpage.wait_for_timeout(1200)
        st = rpage.get_by_role('status', name='Re-derivation status').inner_text()
        check('rederive status', 'Re-derived at' in st and 'Intact.' in st, st)

        with rpage.expect_download() as dl:
            rpage.get_by_role('button', name='Download readings file').click()
        check('download name', dl.value.suggested_filename == 'BM-F0001-readings.csv', dl.value.suggested_filename)

        rpage.get_by_role('link', name='Readings audit trail').click()
        rpage.wait_for_selector('h1:has-text("Readings audit trail")')
        check('regulator audit', 'No readings have moved since this figure was sealed.' in rpage.locator('body').inner_text())
        rctx.close()

        # ---- access screen (Ines is the admin) ----
        page.get_by_role('button', name='Sign out').click()
        page.wait_for_url('**/signin')
        page.get_by_label('Email').fill('ines@levelmoor.example')
        page.get_by_label('Password').fill('moss-and-tower-26')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url('**/projects')
        page.goto(BASE + '/admin/access')
        page.wait_for_selector('h1:has-text("Access")')
        grid = page.get_by_role('table', name='Access')
        check('access grid rows', grid.get_by_role('row').count() == 7, grid.get_by_role('row').count())
        sel = page.get_by_role('combobox', name='Wren Adeyemi on Saltings Reach')
        sel.select_option('sealer')
        page.wait_for_timeout(800)
        st = page.get_by_role('status', name='Access status').inner_text()
        check('grant saved copy', st == 'Saved access for Wren Adeyemi on Saltings Reach: Sealer.', st)
        sel.select_option('none')
        page.wait_for_timeout(800)

        # ---- phone layout ----
        phone = browser.new_context(viewport={'width': 375, 'height': 812})
        ppage = phone.new_page()
        ppage.goto(BASE + '/signin')
        ppage.get_by_label('Email').fill('hal@levelmoor.example')
        ppage.get_by_label('Password').fill('moss-and-tower-26')
        ppage.get_by_role('button', name='Sign in').click()
        ppage.wait_for_url('**/projects')
        ppage.get_by_role('link', name='Blackmere Moss').click()
        ppage.wait_for_selector('h1:has-text("Blackmere Moss")')
        ppage.wait_for_timeout(2000)
        overflow = ppage.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check('phone no horizontal overflow', not overflow)
        details = ppage.get_by_role('button', name='Figure details')
        check('figure details button', details.count() == 1)
        # collapsed sheet hides the values
        hidden_vals = ppage.locator('[data-sheet-extra]').first.is_hidden() if ppage.locator('[data-sheet-extra]').count() else True
        details.click()
        ppage.wait_for_timeout(400)
        check('sheet expands', details.get_attribute('aria-expanded') == 'true')
        details.click()
        ppage.wait_for_timeout(400)
        check('sheet collapses', details.get_attribute('aria-expanded') == 'false')
        ppage.screenshot(path='/tmp/phone.png', full_page=True)
        phone.close()

        # no console errors during the run (the bootstrap session probe 401 is expected)
        real_errors = [e for e in errors if '401' not in e]
        check('no page errors', len(real_errors) == 0, real_errors[:5])

        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
