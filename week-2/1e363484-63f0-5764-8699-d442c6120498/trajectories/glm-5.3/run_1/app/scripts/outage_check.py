#!/usr/bin/env python3
"""Outage checks: seal refusals while storage or mail is unreachable."""
import json
import sys
import urllib.request
import urllib.error
import time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173'
BASE2 = 'http://127.0.0.1:4299'


def req(base, method, path, body=None, cookie=None, headers=None):
    url = base + path
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


def session(base, email):
    s, h, _ = req(base, 'POST', '/api/session', {'email': email, 'password': 'moss-and-tower-26'})
    return 'fluxseal_session=' + h['Set-Cookie'].split('fluxseal_session=')[1].split(';')[0]


def main():
    ok = True
    # an instance with unreachable storage and mail
    import subprocess
    env_proc = subprocess.Popen(
        ['node', 'dist/server/main.cjs'],
        cwd='/app',
        env={
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'DATABASE_URL': 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev',
            'S3_ENDPOINT': 'http://127.0.0.1:59999', 'S3_REGION': 'us-east-1', 'S3_BUCKET': 'gf-dev',
            'S3_FORCE_PATH_STYLE': 'true',
            'S3_ACCESS_KEY_ID': 'x', 'S3_SECRET_ACCESS_KEY': 'x',
            'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': '59998',
            'MAIL_FROM': 'Fluxseal <seals@sedgemoor.example>',
            'APP_PUBLIC_URL': 'http://127.0.0.1:4299', 'APP_PUBLIC_PORT': '4299',
        },
        stdout=open('/tmp/server_outage.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(6)

    hal = session(BASE, 'hal@levelmoor.example')

    try:
        s, h, health = req(BASE2, 'GET', '/api/health')
        ok &= check('outage instance health', s == 200, s)

        s, h, prev = req(BASE2, 'POST', '/api/projects/saltings-reach/preview',
                         {'start': '2026-06-05T10:00:00Z', 'end': '2026-06-05T12:00:00Z',
                          'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2']}, cookie=hal)
        ok &= check('preview works during outage', s == 200 and prev['sealable'], f'{s} {prev}')

        s, h, body = req(BASE2, 'POST', '/api/projects/saltings-reach/figures',
                         {'start': '2026-06-05T10:00:00Z', 'end': '2026-06-05T12:00:00Z',
                          'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2'],
                          'preview_fingerprint': prev['fingerprint']},
                         cookie=hal, headers={'Idempotency-Key': 'outage-1'})
        ok &= check('storage outage refusal', s == 503 and body == {'error': 'storage_unavailable'}, f'{s} {body}')

        # nothing was sealed: no figure, no ledger entry
        s, h, figs = req(BASE, 'GET', '/api/projects/saltings-reach/figures', cookie=hal)
        ok &= check('no figure sealed', figs['summary']['intact_count'] == 0, figs['summary'])
        s, h, led = req(BASE, 'GET', '/api/projects/saltings-reach/ledger', cookie=hal)
        ok &= check('no ledger entries', len(led['entries']) == 0, led['entries'])
    finally:
        env_proc.terminate()
        env_proc.wait()

    # ---- mail sink refuses: instance with storage but dead SMTP ----
    # Use the main instance but with a dead SMTP? The main instance has live mail.
    # Start another instance with S3 reachable but SMTP dead.
    env_proc2 = subprocess.Popen(
        ['node', 'dist/server/main.cjs'],
        cwd='/app',
        env={
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'DATABASE_URL': 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev',
            'S3_ENDPOINT': 'http://minio:9000', 'S3_REGION': 'us-east-1', 'S3_BUCKET': 'gf-dev',
            'S3_FORCE_PATH_STYLE': 'true',
            'S3_ACCESS_KEY_ID': 'gf-dev-root-71c3e0', 'S3_SECRET_ACCESS_KEY': 'gf-dev-secret-4b8d92',
            'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': '59998',
            'MAIL_FROM': 'Fluxseal <seals@sedgemoor.example>',
            'APP_PUBLIC_URL': 'http://127.0.0.1:4299', 'APP_PUBLIC_PORT': '4299',
        },
        stdout=open('/tmp/server_mail.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(6)
    try:
        s, h, prev = req(BASE2, 'POST', '/api/projects/saltings-reach/preview',
                         {'start': '2026-06-05T10:00:00Z', 'end': '2026-06-05T12:00:00Z',
                          'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2']}, cookie=hal)
        s, h, body = req(BASE2, 'POST', '/api/projects/saltings-reach/figures',
                         {'start': '2026-06-05T10:00:00Z', 'end': '2026-06-05T12:00:00Z',
                          'sensor_ids': ['SR-T1', 'SR-S1', 'SR-S2'],
                          'preview_fingerprint': prev['fingerprint']},
                         cookie=hal, headers={'Idempotency-Key': 'outage-2'})
        ok &= check('mail refusal 503', s == 503 and body == {'error': 'mail_unavailable'}, f'{s} {body}')
        s, h, figs = req(BASE, 'GET', '/api/projects/saltings-reach/figures', cookie=hal)
        ok &= check('no figure after mail refusal', figs['summary']['intact_count'] == 0, figs['summary'])
        s, h, led = req(BASE, 'GET', '/api/projects/saltings-reach/ledger', cookie=hal)
        ok &= check('no ledger entries after mail refusal', len(led['entries']) == 0, led['entries'])
    finally:
        env_proc2.terminate()
        env_proc2.wait()

    # ---- UI: the outage journey in the browser ----
    # storage outage again, this time through the dialog
    env_proc3 = subprocess.Popen(
        ['node', 'dist/server/main.cjs'],
        cwd='/app',
        env={
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'DATABASE_URL': 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev',
            'S3_ENDPOINT': 'http://127.0.0.1:59999', 'S3_REGION': 'us-east-1', 'S3_BUCKET': 'gf-dev',
            'S3_FORCE_PATH_STYLE': 'true',
            'S3_ACCESS_KEY_ID': 'x', 'S3_SECRET_ACCESS_KEY': 'x',
            'SMTP_HOST': 'mailpit', 'SMTP_PORT': '1025',
            'MAIL_FROM': 'Fluxseal <seals@sedgemoor.example>',
            'APP_PUBLIC_URL': 'http://127.0.0.1:4299', 'APP_PUBLIC_PORT': '4299',
        },
        stdout=open('/tmp/server_outage2.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(6)
    try:
        # main instance browser session
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
            page = ctx.new_page()
            page.goto(BASE + '/signin')
            page.get_by_label('Email').fill('hal@levelmoor.example')
            page.get_by_label('Password').fill('moss-and-tower-26')
            page.get_by_role('button', name='Sign in').click()
            page.wait_for_url('**/projects')
            page.get_by_role('link', name='Saltings Reach').click()
            page.wait_for_selector('h1:has-text("Saltings Reach")')
            page.wait_for_timeout(2500)

            # arm the preview on a short interval via the sliders: brush starts whole record
            page.get_by_role('slider', name='Interval end').focus()
            for _ in range(48 * 13):
                page.keyboard.press('PageUp')
            page.wait_for_timeout(1200)
            # set a two-hour interval: start = 06-05 10:00, end = 06-05 12:00
            # Use URL state instead for precision
            page.goto(BASE + '/projects/saltings-reach?from=2026-06-05&to=2026-05&start=202606051000&end=202606051200&sensors=SR-S1,SR-S2,SR-T1')
            page.wait_for_selector('h1:has-text("Saltings Reach")')
            page.wait_for_timeout(2000)
            seal_btn = page.get_by_role('button', name='Seal figure')
            ok &= check('preview armed for outage journey', seal_btn.is_enabled())
            figs_before = page.get_by_role('table', name='Figures').inner_text()

            # route the seal through the outage instance: temporarily point the page at :4299
            # (same-origin rule means the app must be served there too)
            page.goto(BASE2 + '/projects/saltings-reach?from=2026-06-05&to=2026-06-05&start=202606051000&end=202606051200&sensors=SR-S1,SR-S2,SR-T1')
            page.wait_for_selector('h1:has-text("Saltings Reach")')
            page.wait_for_timeout(2000)
            page.get_by_role('button', name='Seal figure').click()
            dlg = page.get_by_role('dialog', name='Seal figure')
            dlg.get_by_role('button', name='Confirm seal').click()
            page.wait_for_timeout(2000)
            dlg_alert = dlg.get_by_role('alert')
            ok &= check('storage outage dialog copy',
                        'Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes.' == dlg_alert.inner_text().strip(),
                        dlg_alert.inner_text())
            figs_after = page.get_by_role('table', name='Figures').inner_text()
            ok &= check('figures table unchanged', figs_after == figs_before, figs_after)
            ledger = page.get_by_role('table', name='Sealed-tonnes ledger').inner_text()
            ok &= check('ledger unchanged', '0.000' in ledger, ledger)
            browser.close()
    finally:
        env_proc3.terminate()
        env_proc3.wait()

    print('\nOK' if ok else '\nFAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
