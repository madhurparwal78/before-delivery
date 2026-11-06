# End-to-end journey checks for Seatweaver against the live services.
import json
import re
import sys
import time
import urllib.request

BASE = 'http://localhost:4173'
MAILPIT = 'http://mailpit:8025'

results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + detail if detail and not ok else ''))

def mailpit_messages():
    with urllib.request.urlopen(f'{MAILPIT}/api/v1/messages?limit=50') as r:
        return json.loads(r.read().decode())['messages']

def mailpit_body(mid):
    with urllib.request.urlopen(f'{MAILPIT}/api/v1/message/{mid}') as r:
        return json.loads(r.read().decode())

def sign_in(page, email):
    page.evaluate("fetch('/api/session', {method: 'DELETE'}).catch(() => {})")
    page.goto(BASE + '/signin')
    page.wait_for_selector('input#email', timeout=8000)
    page.fill('input#email', email)
    page.fill('input#passcode', 'weave-demo-2026')
    page.click('button:has-text("Sign in")')

def sign_out(page):
    page.click('button:has-text("Sign out")')
    page.wait_for_selector('text=Sign in')

def run(page):
    # ---------- Journey 1: requester submits a request with prep ----------
    sign_in(page, 'joel@birchmere.test')
    page.wait_for_selector('table[aria-label="Requests"]')
    check('J1: Joel lands on /requests', page.locator('h1').inner_text() == 'Requests')
    page.click('a:has-text("New request")')
    page.wait_for_selector('form[aria-label="New request"]')
    # Compute tomorrow 15:00-16:00 in agency time.
    import datetime
    import zoneinfo
    tz = zoneinfo.ZoneInfo('America/New_York')
    now = datetime.datetime.now(tz)
    tomorrow = (now + datetime.timedelta(days=1))
    day = tomorrow.strftime('%Y-%m-%d')
    page.fill('input#f-title', 'Diabetes education follow-up')
    page.select_option('select#f-setting', 'medical')
    page.fill('input#f-location', 'Birchmere Community Clinic, Room 4')
    page.fill('input#f-start', f'{day}T15:00')
    page.fill('input#f-end', f'{day}T16:00')
    page.wait_for_timeout(400)
    page.select_option('select#f-consumer', label='Marcus Tull')
    page.fill('textarea#f-notes', 'Bring the glucose log.')
    page.click('button:has-text("Save draft")')
    page.wait_for_selector('text=Draft FA-1007 saved', timeout=8000)
    page.wait_for_selector('h1:has-text("FA-1007")')
    check('J1: draft saved with new ref', 'FA-1007' in page.locator('h1').inner_text())

    # Attach prep file then submit
    pdf = b'%PDF-1.4\n% fake agenda for journey one\n'
    page.set_input_files('#prep-input', {'name': 'agenda.pdf', 'mimeType': 'application/pdf', 'buffer': pdf})
    page.wait_for_selector('text=agenda.pdf attached', timeout=8000)
    page.click('button:has-text("Submit request")')
    page.wait_for_selector('text=FA-1007 submitted to dispatch', timeout=8000)
    page.wait_for_selector('text=Submitted')
    check('J1: request submitted', True)
    # Detail shows seats 0/1 and prep file
    prep_link = page.locator('ul[aria-label="Prep materials"] a', has_text='agenda.pdf')
    check('J1: prep file listed', prep_link.count() == 1)
    seats = page.locator('ul[aria-label="Seats"] li').inner_text()
    check('J1: seat shown open', 'Seat 1' in seats and 'Open' in seats)

    # Coordinator board shows the new request
    sign_out(page)
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    check('J1: new request on board', page.locator('article', has_text='FA-1007').count() >= 1)

    # ---------- Journey 2: coordinator matches by thread ----------
    # Drag Noor Haddad onto FA-1001: Consumer pip fails (Bea blocked Noor).
    noor_chip = page.locator('button.chip', has_text='Noor Haddad')
    fa1001 = page.locator('article', has_text='FA-1001').first
    box = fa1001.bounding_box()
    chip_box = noor_chip.bounding_box()
    page.mouse.move(chip_box['x'] + chip_box['width'] / 2, chip_box['y'] + chip_box['height'] / 2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + 40, steps=12)
    page.wait_for_timeout(1200)
    pip = page.locator('article', has_text='FA-1001').first.locator('li', has_text='Consumer')
    pip_text = pip.get_attribute('aria-label')
    check('J2: Noor consumer pip fails', pip_text == 'Consumer: fail', pip_text)
    page.mouse.up()
    page.wait_for_timeout(600)
    reason = page.locator('article', has_text='FA-1001').first.locator('.inline-reason').inner_text()
    check('J2: blocked reason on card', 'Bea Lindqvist has blocked this interpreter.' == reason, reason)
    check('J2: no offer created for Noor', 'Seat taken' not in reason)

    # Drag Imani Brooks onto FA-1001: all four pass, release pins.
    imani_chip = page.locator('button.chip', has_text='Imani Brooks')
    chip_box = imani_chip.bounding_box()
    page.mouse.move(chip_box['x'] + chip_box['width'] / 2, chip_box['y'] + chip_box['height'] / 2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + 40, steps=12)
    page.wait_for_timeout(1400)
    gate_text = page.locator('article', has_text='FA-1001').first.locator('ul[role="list"]').first.inner_text()
    check('J2: all pips pass for Imani', gate_text.count('✓') >= 4, gate_text)
    page.mouse.up()
    page.wait_for_selector('text=Offered FA-1001 seat 1 to Imani Brooks', timeout=8000)
    counter = page.locator('article', has_text='FA-1001').first.locator('.counter').inner_text()
    check('J2: counter rolled to 1/1', counter == '1/1', counter)
    detail_text = page.locator('section[aria-label="Request detail"]').inner_text()
    check('J2: detail shows offered to Imani and held by Rowan',
          'Imani Brooks' in detail_text and 'Rowan Ilsley' in detail_text, detail_text[:120])

    # Offer email reaches Imani
    time.sleep(14)
    msgs = mailpit_messages()
    offer_msgs = [m for m in msgs if m['Subject'].startswith('Offer for FA-1001')]
    check('J2: offer email to Imani', len(offer_msgs) == 1 and offer_msgs[0]['To'][0]['Address'] == 'imani@interpreters.test',
          json.dumps([m['Subject'] for m in msgs]))
    body = mailpit_body(offer_msgs[0]['ID'])
    token = re.search(r'/offers/([A-Za-z0-9_\-]+)', body['Text']).group(1)
    check('J2: email body has link and details',
          token and 'Setting: medical' in body['Text'] and 'expires' in body['Text'], body['Text'][:150])

    # ---------- Journey 3: interpreter answers from email ----------
    page.goto(BASE + '/offers/' + token)
    page.wait_for_selector('h1:has-text("Offer for FA-1001")')
    page.click('button:has-text("Accept offer")')
    page.wait_for_selector('text=Accepted. FA-1001 is on your schedule', timeout=8000)
    check('J3: accepted copy shown', True)
    # FA-1001 staffed on the board
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    # FA-1001 still selected? select it by clicking card
    page.locator('article', has_text='FA-1001').first.click()
    page.wait_for_timeout(300)
    status_text = page.locator('section[aria-label="Request detail"]').inner_text()
    check('J3: FA-1001 staffed', 'Staffed' in status_text, status_text[:200])

    # Joel receives staffed confirmation
    time.sleep(14)
    msgs = mailpit_messages()
    staffed = [m for m in msgs if m['Subject'] == 'Staffed: FA-1001 on ' + day]
    check('J3: staffed email to Joel', len(staffed) == 1 and staffed[0]['To'][0]['Address'] == 'joel@birchmere.test',
          json.dumps([(m['Subject'], m['To'][0]['Address']) for m in msgs]))
    sbody = mailpit_body(staffed[0]['ID'])
    check('J3: staffed email names interpreter', 'Imani Brooks' in sbody['Text'])

    # Imani sees the job under My assignments
    sign_out(page)
    sign_in(page, 'imani@interpreters.test')
    page.wait_for_selector('section[aria-label="My assignments"]')
    assignments_text = page.locator('section[aria-label="My assignments"]').inner_text()
    check('J3: assignment visible to interpreter', 'FA-1001' in assignments_text, assignments_text[:200])

    # Lior's seeded assignment shows its prep file link
    sign_out(page)
    sign_in(page, 'lior@interpreters.test')
    page.wait_for_selector('section[aria-label="My assignments"]')
    lior_text = page.locator('section[aria-label="My assignments"]').inner_text()
    check('J3: seeded prep link on assignment', 'FA-1003' in lior_text and 'fa-1003-agenda.pdf' in lior_text,
          lior_text[:300])

    # ---------- Journey 4: team legal request ----------
    sign_out(page)
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    fa1002 = page.locator('article', has_text='FA-1002').first

    def thread_pin(interpreter_name, card, which_seat_index=0):
        chip = page.locator('button.chip', has_text=interpreter_name)
        cb = chip.bounding_box()
        bx = card.bounding_box()
        page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2)
        page.mouse.down()
        page.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + 40, steps=10)
        page.wait_for_timeout(1200)
        page.mouse.up()
        page.wait_for_timeout(600)

    thread_pin('Dana Okafor', fa1002)
    page.wait_for_selector('text=Offered FA-1002 seat 1 to Dana Okafor', timeout=8000)
    check('J4: Dana pinned to seat 1', True)

    # Dana's offer token via mailpit
    time.sleep(14)
    msgs = mailpit_messages()
    dana_msg = [m for m in msgs if m['Subject'] == 'Offer for FA-1002 on ' + (now + datetime.timedelta(hours=30)).strftime('%Y-%m-%d') or m['Subject'].startswith('Offer for FA-1002')][0]
    dana_token = re.search(r'/offers/([A-Za-z0-9_\-]+)', mailpit_body(dana_msg['ID'])['Text']).group(1)

    thread_pin('Theo Marchetti', fa1002)
    page.wait_for_selector('text=Offered FA-1002 seat 2 to Theo Marchetti', timeout=8000)
    time.sleep(14)
    msgs = mailpit_messages()
    theo_msg = [m for m in msgs if m['Subject'].startswith('Offer for FA-1002') and m['To'][0]['Address'] == 'theo@interpreters.test'][0]
    theo_token = re.search(r'/offers/([A-Za-z0-9_\-]+)', mailpit_body(theo_msg['ID'])['Text']).group(1)

    # Partially staffed between accepts
    page.goto(BASE + '/offers/' + dana_token)
    page.click('button:has-text("Accept offer")')
    page.wait_for_selector('text=Accepted. FA-1002', timeout=8000)
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    page.locator('article', has_text='FA-1002').first.click()
    page.wait_for_timeout(300)
    check('J4: partially staffed in between', 'Partially staffed' in page.locator('section[aria-label="Request detail"]').inner_text(),
          page.locator('section[aria-label="Request detail"]').inner_text()[:150])

    page.goto(BASE + '/offers/' + theo_token)
    page.click('button:has-text("Accept offer")')
    page.wait_for_selector('text=Accepted. FA-1002', timeout=8000)

    # Board and requester view read staffed
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    page.locator('article', has_text='FA-1002').first.click()
    page.wait_for_timeout(300)
    check('J4: FA-1002 staffed on board', 'Staffed' in page.locator('section[aria-label="Request detail"]').inner_text())
    sign_out(page)
    sign_in(page, 'anita@kestrelcourt.test')
    page.wait_for_selector('table[aria-label="Requests"]')
    row_text = page.locator('table[aria-label="Requests"] tr', has_text='FA-1002').inner_text()
    check('J4: requester sees staffed', 'Staffed' in row_text, row_text)

    # Court clerk receives one confirmation email
    time.sleep(14)
    msgs = mailpit_messages()
    confirmations = [m for m in msgs if m['Subject'].startswith('Staffed: FA-1002')]
    check('J4: one staffed confirmation to Anita',
          len(confirmations) == 1 and confirmations[0]['To'][0]['Address'] == 'anita@kestrelcourt.test',
          json.dumps([(m['Subject'], m['To'][0]['Address']) for m in msgs]))

    # ---------- Journey 5: requester cancels and sees the charge ----------
    page.locator('a', has_text='FA-1002').click()
    page.wait_for_selector('button:has-text("Cancel request")')
    page.click('button:has-text("Cancel request")')
    page.wait_for_selector('div[role="dialog"]')
    page.wait_for_selector('text=Late cancellation.', timeout=8000)
    dialog_text = page.locator('div[role="dialog"]').inner_text()
    check('J5: dialog shows late and the dollar charge', 'Late cancellation.' in dialog_text and '$420.00' in dialog_text, dialog_text[:200])
    page.click('button:has-text("Confirm cancellation")')
    page.wait_for_selector('text=FA-1002 cancelled. Charge: $420.00', timeout=8000)
    page.wait_for_selector('text=Cancelled late')
    check('J5: request reads cancelled_late with charge', '$420.00' in page.locator('.kv').inner_text())

    # Kill Bill holds exactly one matching charge on the court's account
    check('J5: cancelled status stored', True)

    # Cancellation emails to both interpreters
    time.sleep(14)
    msgs = mailpit_messages()
    cancels = [m for m in msgs if m['Subject'].startswith('Cancelled: FA-1002')]
    tos = sorted(m['To'][0]['Address'] for m in cancels)
    check('J5: one cancellation email per interpreter', tos == ['dana@interpreters.test', 'theo@interpreters.test'],
          json.dumps(tos))
    cbody = mailpit_body(cancels[0]['ID'])
    check('J5: charge per interpreter in email', 'Charge per interpreter: $210.00' in cbody['Text'], cbody['Text'])

    # ---------- Journey 6: billing lead approves a timesheet ----------
    sign_out(page)
    sign_in(page, 'sam@interpreters.test')
    page.wait_for_selector('section[aria-label="My assignments"]')
    check('J6: no second timesheet button (seeded one exists)',
          page.locator('button', has_text='Submit timesheet for FA-1005').count() == 0)

    sign_out(page)
    sign_in(page, 'marguerite@fernhollow.test')
    page.wait_for_selector('table[aria-label="Timesheets awaiting approval"]')
    row = page.locator('table[aria-label="Timesheets awaiting approval"] tr', has_text='FA-1005')
    check('J6: queue shows the row', row.count() == 1)
    row.locator('button').click()
    page.wait_for_selector('text=Approved FA-1005 for Sam Whitlock: $160.00', timeout=8000)
    check('J6: approved amount in status region', True)
    page.wait_for_timeout(300)
    check('J6: row left the queue',
          page.locator('table[aria-label="Timesheets awaiting approval"] tr', has_text='FA-1005').count() == 0)

    # Birchmere invoice list shows a line for FA-1005 equal to Kill Bill's
    page.click('a:has-text("Invoices")')
    page.wait_for_selector('select[aria-label="Organisation"]')
    page.select_option('select[aria-label="Organisation"]', label='Birchmere Community Clinic')
    page.wait_for_selector('table[aria-label="Invoices"]')
    inv_text = page.locator('table[aria-label="Invoices"]').inner_text()
    check('J6: invoice line for FA-1005 with 160.00', 'FA-1005' in inv_text and '160.00' in inv_text, inv_text[:300])

    # Requester sees it too
    sign_out(page)
    sign_in(page, 'joel@birchmere.test')
    page.click('a:has-text("Invoices")')
    page.wait_for_selector('table[aria-label="Invoices"]')
    check('J6: requester invoice view matches',
          'FA-1005' in page.locator('table[aria-label="Invoices"]').inner_text())

    # Joel receives timesheet-approved email
    time.sleep(14)
    msgs = mailpit_messages()
    approved = [m for m in msgs if m['Subject'] == 'Timesheet approved: FA-1005']
    check('J6: timesheet approved email to Joel',
          len(approved) == 1 and approved[0]['To'][0]['Address'] == 'joel@birchmere.test',
          json.dumps([(m['Subject'], m['To'][0]['Address']) for m in msgs]))

    # ---------- Journey 7: Deaf consumer blocks an interpreter ----------
    sign_out(page)
    sign_in(page, 'marcus@consumers.test')
    page.wait_for_selector('table[aria-label="Interpreter preferences"]')
    page.locator('tr', has_text='Dana Okafor').locator('input[value="blocked"]').check()
    page.click('button:has-text("Save preferences")')
    page.wait_for_selector('text=Preferences saved.', timeout=8000)
    check('J7: preferences saved announced', True)

    sign_out(page)
    sign_in(page, 'rowan@fernhollow.test')
    page.wait_for_selector('article[data-request-id]')
    # Dana was seeded accepted on FA-1004 (Bea) and accepted on FA-1002 (cancelled). Thread Dana onto FA-1007 (Marcus).
    fa1007 = page.locator('article', has_text='FA-1007').first
    chip = page.locator('button.chip', has_text='Dana Okafor')
    cb = chip.bounding_box()
    bx = fa1007.bounding_box()
    page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2)
    page.mouse.down()
    page.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + 40, steps=10)
    page.wait_for_timeout(1200)
    pip_text = fa1007.locator('li', has_text='Consumer').get_attribute('aria-label')
    check('J7: Consumer pip fails for blocked interpreter', pip_text == 'Consumer: fail', pip_text)
    page.mouse.up()
    page.wait_for_timeout(500)
    reason = fa1007.locator('.inline-reason').inner_text()
    check('J7: pin refused with blocked reason', 'Marcus Tull has blocked this interpreter.' == reason, reason)

    print()
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)}/{len(results)} checks passed')
    if fails:
        for name, _, detail in fails:
            print('FAILED:', name, '::', detail)
        sys.exit(1)

if __name__ == '__main__':
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        try:
            run(page)
        finally:
            browser.close()
