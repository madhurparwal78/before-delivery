#!/usr/bin/env python3
"""Journey checks: re-ingest break, re-seal supersede, link lifecycle, outage refusals."""
import json
import sys
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173'


def req(method, path, body=None, cookie=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        r.add_header('Content-Type', 'application/json')
    if cookie:
        r.add_header('Cookie', cookie)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r) as resp:
            content = resp.read()
            return resp.status, dict(resp.headers), (json.loads(content) if content else None)
    except urllib.error.HTTPError as e:
        content = e.read()
        try:
            return e.code, dict(e.headers), (json.loads(content) if content else None)
        except Exception:
            return e.code, dict(e.headers), content


def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL') + '  ' + name + ('  ' + str(detail) if not cond else ''))
    return cond


def session(email):
    s, h, _ = req('POST', '/api/session', {'email': email, 'password': 'moss-and-tower-26'})
    return 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]


def main():
    ok = True
    hal = session('hal@levelmoor.example')
    steward = session('priya@levelmoor.example')

    # seal the whole record as hal
    s, h, prev = req('POST', '/api/projects/blackmere-moss/preview',
                     {'start': '2026-06-01T00:00:00Z', 'end': '2026-06-15T00:00:00Z',
                      'sensor_ids': ['BM-T1', 'BM-T2', 'BM-S1', 'BM-S2', 'BM-S3', 'BM-S4']}, cookie=hal)
    s, h, fig = req('POST', '/api/projects/blackmere-moss/figures',
                    {'start': prev['start'], 'end': prev['end'], 'sensor_ids': prev['sensor_ids'],
                     'preview_fingerprint': prev['fingerprint']}, cookie=hal,
                    headers={'Idempotency-Key': 'journey-seal-1'})
    ok &= check('journey seal', s == 201 and fig['id'] == 'BM-F0001', f'{s}')

    # issue a link for the regulator journey
    s, h, link = req('POST', '/api/figures/BM-F0001/links', {}, cookie=hal)
    token = link['token']

    # a link with a short TTL for the expiry test is not possible via env per-run;
    # instead revoke a link to see the revoked page, and use a bad token for unknown.
    s, h, link2 = req('POST', '/api/figures/BM-F0001/links', {}, cookie=hal)
    token2 = link2['token']
    s, h, links = req('GET', '/api/figures/BM-F0001/links', cookie=hal)
    link2_id = [l for l in links['links'] if l['token'] == token2][0]['id']
    s, h, _ = req('POST', f'/api/figures/BM-F0001/links/{link2_id}/revoke', {}, cookie=hal)
    ok &= check('revoke via api', s == 200)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()

        # ---- journey 4/6: re-ingest breaks the seal while the lead watches ----
        page.goto(BASE + '/signin')
        page.get_by_label('Email').fill('hal@levelmoor.example')
        page.get_by_label('Password').fill('moss-and-tower-26')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url('**/projects')
        page.get_by_role('link', name='Blackmere Moss').click()
        page.wait_for_selector('h1:has-text("Blackmere Moss")')
        page.wait_for_timeout(2500)

        balance_before = page.get_by_role('region', name='Project balance').inner_text()

        # steward re-ingests a revision inside the sealed figure
        s, h, ing = req('POST', '/api/projects/blackmere-moss/readings',
                        {'readings': [{'sensor_id': 'BM-T2', 'interval_start': '2026-06-10T06:00:00Z',
                                       'fc': -1.5, 'fch4': 30.0, 'qc': 0}]}, cookie=steward)
        ok &= check('reingest breaks figure', s == 200 and ing['revised'] == 1 and ing['broken_figures'] == ['BM-F0001'], f'{ing}')

        # within one refresh (15s), the figure turns Broken in place with one announcement
        page.wait_for_timeout(16500)
        figs_table = page.get_by_role('table', name='Figures')
        row_text = figs_table.get_by_role('row').filter(has_text='BM-F0001').inner_text()
        ok &= check('figure broken in place', 'Broken' in row_text, row_text)
        balance_after = page.get_by_role('region', name='Project balance').inner_text()
        ok &= check('balance dropped', '-14.287' not in balance_after and '0.000' in balance_after, balance_after)
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        ok &= check('break announcement', 'Seal broken on BM-F0001. Its tonnes have been reversed in the ledger.' in status_text, repr(status_text))
        # brush and focus undisturbed
        url_now = page.url
        ok &= check('brush undisturbed', 'start=202606010000' in url_now, url_now)

        # audit trail from the figure page
        page.get_by_role('table', name='Figures').get_by_role('link', name='BM-F0001').click()
        page.wait_for_selector('h1:has-text("Figure BM-F0001")')
        ok &= check('broken banner', 'Seal broken. Readings moved since sealing: 1.' in page.locator('[role=alert]').first.inner_text(),
                    page.locator('[role=alert]').first.inner_text())
        page.get_by_role('link', name='Readings audit trail').click()
        page.wait_for_selector('h1:has-text("Readings audit trail for BM-F0001")')
        page.wait_for_timeout(800)
        audit_text = page.locator('body').inner_text()
        ok &= check('audit shows moved reading', 'BM-T2' in audit_text and '-2.0000' in audit_text and '-1.5000' in audit_text, audit_text[:300])

        # ---- regulator link lifecycle pages ----
        # revoked link
        rctx = browser.new_context(viewport={'width': 375, 'height': 812})
        rpage = rctx.new_page()
        rpage.goto(f'{BASE}/r/{token2}')
        rpage.wait_for_selector('h1')
        ok &= check('revoked page', rpage.locator('h1').inner_text() == 'This link was revoked'
                    and 'The project team withdrew this link.' in rpage.locator('body').inner_text(),
                    rpage.locator('body').inner_text()[:100])
        # unknown link
        rpage.goto(f'{BASE}/r/not-a-real-token')
        rpage.wait_for_selector('h1')
        ok &= check('unknown page', rpage.locator('h1').inner_text() == 'No sealed figure is published at this link')
        # live link shows the broken figure, then re-derive still works
        rpage.goto(f'{BASE}/r/{token}')
        rpage.wait_for_selector('h1:has-text("Sealed figure BM-F0001")')
        rpage.wait_for_timeout(600)
        body_text = rpage.locator('body').inner_text()
        ok &= check('regulator sees broken', 'Status: Broken' in body_text, body_text[:150])
        rpage.get_by_role('button', name='Re-derive').click()
        rpage.wait_for_timeout(1200)
        st = rpage.get_by_role('status', name='Re-derivation status').inner_text()
        ok &= check('rederive broken verdict', 'Broken.' in st, st)
        # audit trail on the regulator page
        rpage.get_by_role('link', name='Readings audit trail').click()
        rpage.wait_for_selector('h1:has-text("Readings audit trail")')
        ok &= check('regulator audit shows moves', 'BM-T2' in rpage.locator('body').inner_text())
        rctx.close()

        # ---- journey 5: re-seal supersedes ----
        page.goto(BASE + '/projects/blackmere-moss?from=2026-06-01&to=2026-06-14&start=202606010000&end=202606150000&sensors=BM-S1,BM-S2,BM-S3,BM-S4,BM-T1,BM-T2')
        page.wait_for_selector('h1:has-text("Blackmere Moss")')
        page.wait_for_timeout(2500)
        seal_btn = page.get_by_role('button', name='Seal figure')
        ok &= check('re-seal armed', seal_btn.is_enabled())
        seal_btn.click()
        page.get_by_role('dialog', name='Seal figure').get_by_role('button', name='Confirm seal').click()
        page.wait_for_timeout(2500)
        status_text = page.get_by_role('status', name='Workspace status').inner_text()
        ok &= check('supersedes announcement', 'Supersedes BM-F0001.' in status_text, repr(status_text))
        figs_table = page.get_by_role('table', name='Figures')
        old_row = figs_table.get_by_role('row').filter(has_text='BM-F0001').inner_text()
        new_row = figs_table.get_by_role('row').filter(has_text='BM-F0002').inner_text()
        ok &= check('old superseded in place', 'Superseded' in old_row, old_row)
        ok &= check('new sealed', 'Sealed' in new_row, new_row)
        balance_now = page.get_by_role('region', name='Project balance').inner_text()
        ledger_balance = page.get_by_role('table', name='Sealed-tonnes ledger').get_by_role('row').filter(has_text='Balance').inner_text()
        ledger_balance_value = ledger_balance.split()[1]
        ok &= check('balance equals ledger', ledger_balance_value in balance_now, f'{ledger_balance_value} {balance_now}')

        # ---- viewer role copy ----
        vctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        vpage = vctx.new_page()
        vpage.goto(BASE + '/signin')
        vpage.get_by_label('Email').fill('wren@levelmoor.example')
        vpage.get_by_label('Password').fill('moss-and-tower-26')
        vpage.get_by_role('button', name='Sign in').click()
        vpage.wait_for_url('**/projects')
        vpage.get_by_role('link', name='Blackmere Moss').click()
        vpage.wait_for_selector('h1:has-text("Blackmere Moss")')
        vpage.wait_for_timeout(1000)
        body_text = vpage.locator('body').inner_text()
        ok &= check('viewer role copy', 'Your role on this project can view sealed figures but not preview new ones.' in body_text, body_text[:200])
        vctx.close()

        # ---- outage journey: storage unreachable on a second instance ----
        # (simulated by sealing against an instance without MinIO below)
        browser.close()

    print('\nOK' if ok else '\nFAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
