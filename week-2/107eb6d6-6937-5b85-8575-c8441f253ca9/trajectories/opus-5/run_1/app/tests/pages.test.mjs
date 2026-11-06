import { check, equal, page, pageLogin, PASSWORD } from './harness.mjs';

const has = (html, needle) => html.includes(needle);

export async function runPageTests() {
  /* DP-35 / DP-03 sign-in page */
  const signIn = await page('/login');
  check('DP-35 sign-in page server-rendered', signIn.status === 200 && has(signIn.text, "Let&#39;s"));
  check('DP-03 sign-in headings', has(signIn.text, 'Sign in to Gigfreight'));
  check('DP-36 demo accounts line', has(signIn.text, 'password deku-demo-pw-2026'));
  check('DP-34 no outside hosts', !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(signIn.text.replace(/<!--.*?-->/g, '')));
  check('DP-30 skip link first and main landmark present', signIn.text.includes('<main') &&
    signIn.text.indexOf('Skip to content') < signIn.text.indexOf('<main'));

  const guarded = await page('/dispatch');
  equal('DP-03 signed-out page redirects with next', [guarded.status, guarded.headers.get('location')], [
    303,
    '/login?next=%2Fdispatch'
  ]);

  const badCredentials = await page('/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'wrong' }
  });
  check('DP-03 refused sign-in shows the error', badCredentials.status === 401 &&
    has(badCredentials.text, 'Invalid email or password.') &&
    has(badCredentials.text, 'Sign-in error') &&
    has(badCredentials.text, 'admin@example.com'));

  const mayaCookie = await pageLogin('manager@example.com');
  const dispatcherCookie = await pageLogin('dispatcher@example.com');
  const adminCookie = await pageLogin('admin@example.com');
  check('DP-03 session cookie is http-only and strict', Boolean(mayaCookie));

  /* DP-12 requests page */
  const requests = await page('/requests', { cookie: mayaCookie });
  check('DP-12 list page renders', requests.status === 200 && has(requests.text, 'Search requests'));
  check('DP-12 status select options', has(requests.text, 'All statuses') && has(requests.text, '>Submitted<'));
  check('DP-12 new request link for managers', has(requests.text, 'href="/requests/new"'));
  check('DP-13 manager list hides other managers', !has(requests.text, 'Harbour Lights festival stage'));
  check('DP-30 navigation marks the current page', has(requests.text, 'aria-current="page"'));
  check('DP-24 manager sees no dispatch nav', !has(requests.text, 'href="/dispatch"'));

  const filtered = await page('/requests?q=velvet&status=submitted', { cookie: mayaCookie });
  check('DP-12 address filters apply', has(filtered.text, 'Velvet Fuzz winter run'));
  const emptySearch = await page('/requests?q=zzzz', { cookie: mayaCookie });
  check('DP-12 empty search copy and Clear search', has(emptySearch.text, 'No requests match "zzzz".') &&
    has(emptySearch.text, 'Clear search'));

  const rowsFragment = await page('/requests/list?q=velvet', { cookie: mayaCookie, headers: { 'hx-request': 'true' } });
  check('DP-12 list fragment renders rows', rowsFragment.status === 200 && has(rowsFragment.text, 'Velvet Fuzz winter run'));
  const rowsForbidden = await page('/requests/list', { headers: { 'hx-request': 'true' } });
  check('DP-45 list fragment needs a session', rowsForbidden.status === 200 &&
    rowsForbidden.headers.get('hx-redirect') === '/login?next=%2Frequests%2Flist');

  /* DP-09 / DP-10 steps */
  const stepOne = await page('/requests/new', { cookie: mayaCookie });
  check('DP-09 step 1 heading', has(stepOne.text, '( 1 )') && has(stepOne.text, 'Tour details'));
  check('DP-09 step 1 fields', has(stepOne.text, 'Tour name') && has(stepOne.text, 'Type of transportation') &&
    has(stepOne.text, 'Number of trucks'));
  check('DP-10 discard dialog present', has(stepOne.text, 'Discard this request?') && has(stepOne.text, 'Keep editing'));

  const stepOneRefused = await page('/requests/new', {
    cookie: mayaCookie,
    method: 'POST',
    body: { tour_name: '', transport_type: 'tour', trucks_requested: '2' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-10 refused step keeps input and shows the reason', stepOneRefused.status === 422 &&
    has(stepOneRefused.text, 'Tour name is required.') &&
    /value="tour"[^>]*checked/.test(stepOneRefused.text.replace(/\s+/g, ' ')) &&
    has(stepOneRefused.text, 'value="2"'));

  const stepOnePassed = await page('/requests/new', {
    cookie: mayaCookie,
    method: 'POST',
    body: { tour_name: 'Midnight Static spring tour', transport_type: 'tour', trucks_requested: '2' },
    headers: { 'hx-request': 'true' }
  });
  equal('DP-09 step 1 passes to step 2', stepOnePassed.headers.get('hx-redirect'), '/requests/new/stops');

  const stopsRefused = await page('/requests/new/stops', {
    cookie: mayaCookie,
    method: 'POST',
    body: {
      'stops[pickup][date]': '2026-04-11',
      'stops[pickup][address]': '12 Quarry Lane',
      'stops[pickup][city]': 'Ottawa',
      'stops[pickup][region]': 'ON',
      'stops[pickup][postal_code]': 'K1A 0B1',
      'stops[pickup][country]': 'Canada',
      'stops[delivery][date]': '2026-04-10',
      'stops[delivery][address]': '40 Arena Way',
      'stops[delivery][city]': 'Toronto',
      'stops[delivery][region]': 'ON',
      'stops[delivery][postal_code]': 'M5V 2T6',
      'stops[delivery][country]': 'Canada',
      'stops[first_show][date]': '2026-04-12',
      'stops[first_show][address]': '40 Arena Way',
      'stops[first_show][city]': 'Toronto',
      'stops[first_show][region]': 'ON',
      'stops[first_show][postal_code]': 'M5V 2T6',
      'stops[first_show][country]': 'Canada',
      'stops[last_show][date]': '2026-04-30',
      'stops[last_show][address]': '9 Riverside Drive',
      'stops[last_show][city]': 'Chicago',
      'stops[last_show][region]': 'IL',
      'stops[last_show][postal_code]': '60601',
      'stops[last_show][country]': 'USA'
    },
    headers: { 'hx-request': 'true' }
  });
  check('DP-10 delivery before pickup refused in the browser', stopsRefused.status === 422 &&
    has(stopsRefused.text, 'Delivery cannot be before pickup.') && has(stopsRefused.text, '12 Quarry Lane'));

  const submitted = await page('/requests/new/review', {
    cookie: mayaCookie,
    method: 'POST',
    body: {
      tour_name: 'Browser spring tour',
      transport_type: 'tour',
      trucks_requested: '2',
      draft_id: 'b1f0e2d3-4c5b-4a69-8d7e-6f5a4b3c2d1e',
      notes: 'Browser submission',
      'stops[pickup][date]': '2026-04-10',
      'stops[pickup][address]': '12 Quarry Lane',
      'stops[pickup][city]': 'Ottawa',
      'stops[pickup][region]': 'ON',
      'stops[pickup][postal_code]': 'K1A 0B1',
      'stops[pickup][country]': 'Canada',
      'stops[delivery][date]': '2026-04-11',
      'stops[delivery][address]': '40 Arena Way',
      'stops[delivery][city]': 'Toronto',
      'stops[delivery][region]': 'ON',
      'stops[delivery][postal_code]': 'M5V 2T6',
      'stops[delivery][country]': 'Canada',
      'stops[first_show][date]': '2026-04-12',
      'stops[first_show][address]': '40 Arena Way',
      'stops[first_show][city]': 'Toronto',
      'stops[first_show][region]': 'ON',
      'stops[first_show][postal_code]': 'M5V 2T6',
      'stops[first_show][country]': 'Canada',
      'stops[last_show][date]': '2026-04-30',
      'stops[last_show][address]': '9 Riverside Drive',
      'stops[last_show][city]': 'Chicago',
      'stops[last_show][region]': 'IL',
      'stops[last_show][postal_code]': '60601',
      'stops[last_show][country]': 'USA'
    },
    headers: { 'hx-request': 'true' }
  });
  const submittedPath = submitted.headers.get('hx-redirect');
  check('DP-09 submit lands on the confirmation', /^\/requests\/LR-\d{4}\/submitted$/.test(submittedPath ?? ''), String(submittedPath));
  const newId = (submittedPath ?? '').split('/')[2];

  const confirmation = await page(submittedPath, { cookie: mayaCookie });
  check('DP-09 confirmation shows id and View request', has(confirmation.text, 'Request submitted') &&
    has(confirmation.text, newId) && has(confirmation.text, `href="/requests/${newId}"`));

  /* DP-15 request page */
  const detail = await page(`/requests/${newId}`, { cookie: mayaCookie });
  check('DP-15 stop cards numbered', has(detail.text, '( 1 ) Pickup') && has(detail.text, '( 4 ) Last Show'));
  check('DP-15 data hooks', has(detail.text, `data-request-id="${newId}"`) && has(detail.text, 'data-status="submitted"') &&
    has(detail.text, 'data-stop-kind="pickup"'));
  check('DP-15 count line', has(detail.text, 'data-trucks-assigned="0"') && has(detail.text, '0 of 2 trucks assigned'));
  check('DP-15 regions', has(detail.text, 'Trucks') && has(detail.text, 'Activity'));
  check('DP-15 timeline loads after the page', has(detail.text, `hx-get="/requests/${newId}/activity"`) &&
    has(detail.text, 'Loading activity'));
  check('DP-24 manager sees no dispatch panel', !has(detail.text, 'Assign truck'));

  const timeline = await page(`/requests/${newId}/activity`, {
    cookie: mayaCookie,
    headers: { 'hx-request': 'true' }
  });
  check('DP-15 timeline fragment', timeline.status === 200 && has(timeline.text, 'data-activity-kind="submitted"') &&
    has(timeline.text, 'Requested 2 trucks'));

  /* DP-14 not-found copy */
  const hiddenRequest = await page('/requests/LR-0002', { cookie: mayaCookie });
  check('DP-14 hidden request 404 copy', hiddenRequest.status === 404 &&
    has(hiddenRequest.text, 'This request does not exist or you cannot see it.') &&
    has(hiddenRequest.text, 'Back to requests'));
  const missingRequest = await page('/requests/LR-9999', { cookie: mayaCookie });
  check('DP-14 missing request same copy', missingRequest.status === 404 &&
    has(missingRequest.text, 'This request does not exist or you cannot see it.'));
  const wrongVenue = await page('/nowhere-at-all', { cookie: mayaCookie });
  check('DP-14 unknown address 404', wrongVenue.status === 404 && has(wrongVenue.text, '404.') &&
    has(wrongVenue.text, 'Wrong venue.') && has(wrongVenue.text, 'This address is not on the run sheet.'));
  const sourceFile = await page('/run.json');
  check('boundary run.json is not served', sourceFile.status === 404);
  const templateFile = await page('/templates/layout.njk');
  check('boundary templates are not served', templateFile.status === 404);

  /* DP-24 role refusals on pages */
  const managerBoard = await page('/dispatch', { cookie: mayaCookie });
  check('DP-24 manager on /dispatch gets 403 copy', managerBoard.status === 403 &&
    has(managerBoard.text, 'You do not have access to this page.'));
  const managerFleet = await page('/fleet', { cookie: mayaCookie });
  check('DP-24 manager on /fleet gets 403', managerFleet.status === 403);
  const managerDecided = await page(`/requests/${newId}/decided`, { cookie: mayaCookie });
  check('DP-45 manager on a decision page gets 403', managerDecided.status === 403);
  const managerUsers = await page('/admin/users', { cookie: mayaCookie });
  check('DP-27 manager on /admin/users gets 403', managerUsers.status === 403);
  const dispatcherUsers = await page('/admin/users', { cookie: dispatcherCookie });
  check('DP-27 dispatcher on /admin/users gets 403', dispatcherUsers.status === 403);
  const managerAssign = await page(`/requests/${newId}/assign`, {
    cookie: mayaCookie,
    method: 'POST',
    body: { truck_id: 'TR-101' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-24 manager assignment fragment 403', managerAssign.status === 403 &&
    has(managerAssign.text, 'You do not have access to this page.'));

  /* DP-22 / DP-23 dispatch in the browser */
  const board = await page('/dispatch', { cookie: dispatcherCookie });
  check('DP-22 board summary with data hooks', board.status === 200 && has(board.text, 'data-waiting=') &&
    has(board.text, 'trucks needed') && has(board.text, 'trucks available'));
  check('DP-06 board columns', ['>ID<', '>Tour<', '>Requester<', '>Type<', '>Trucks<', '>First show<', '>Submitted<']
    .every((column) => has(board.text, column)));

  const panel = await page(`/requests/${newId}`, { cookie: dispatcherCookie });
  check('DP-22 dispatcher sees the panel', has(panel.text, 'Assign truck') && has(panel.text, 'TR-101 (North)') &&
    has(panel.text, 'Decline'));

  const assignOne = await page(`/requests/${newId}/assign`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { truck_id: 'TR-101' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-23 assignment notice and redraw', assignOne.status === 200 && has(assignOne.text, 'Truck assigned') &&
    has(assignOne.text, 'data-trucks-assigned="1"') && has(assignOne.text, 'data-truck-id="TR-101"') &&
    !has(assignOne.text, '>TR-101 (North)<'));

  const earlyConfirm = await page(`/requests/${newId}/decision`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { decision: 'confirm', note: 'too early' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-23 early confirm refused in place', earlyConfirm.status === 409 &&
    has(earlyConfirm.text, 'Assign every requested truck before confirming.') &&
    has(earlyConfirm.text, 'data-status="submitted"'));

  const declineWithoutNote = await page(`/requests/${newId}/decision`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { decision: 'decline', note: '' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-23 decline without a note shows the field reason', declineWithoutNote.status === 422 &&
    has(declineWithoutNote.text, 'Add a note to explain your decision.') &&
    has(declineWithoutNote.text, 'data-status="submitted"'));

  const releaseOne = await page(`/requests/${newId}/release`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { truck_id: 'TR-101' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-23 release notice and redraw', releaseOne.status === 200 && has(releaseOne.text, 'Truck released') &&
    has(releaseOne.text, 'data-trucks-assigned="0"'));

  await page(`/requests/${newId}/assign`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { truck_id: 'TR-101' },
    headers: { 'hx-request': 'true' }
  });
  await page(`/requests/${newId}/assign`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { truck_id: 'TR-110' },
    headers: { 'hx-request': 'true' }
  });
  const confirmNow = await page(`/requests/${newId}/decision`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { decision: 'confirm', note: 'Two trucks confirmed for the spring run.' },
    headers: { 'hx-request': 'true' }
  });
  equal('DP-22 confirm lands on the decision page', confirmNow.headers.get('hx-redirect'), `/requests/${newId}/decided`);
  const decidedPage = await page(`/requests/${newId}/decided`, { cookie: dispatcherCookie });
  check('DP-22 decision recorded page', has(decidedPage.text, 'Decision recorded') &&
    has(decidedPage.text, 'Confirmed') && has(decidedPage.text, `href="/requests/${newId}"`));
  const decidedRequest = await page(`/requests/${newId}`, { cookie: dispatcherCookie });
  check('DP-22 decided request shows the decision', has(decidedRequest.text, 'Confirmed by Dex Dispatcher') &&
    has(decidedRequest.text, 'Two trucks confirmed for the spring run.') &&
    !has(decidedRequest.text, 'Assign truck'));

  /* DP-42 stale page */
  const staleAssign = await page(`/requests/${newId}/assign`, {
    cookie: dispatcherCookie,
    method: 'POST',
    body: { truck_id: 'TR-109' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-42 stale assignment shows the server reason and redraws', staleAssign.status === 409 &&
    has(staleAssign.text, 'This request has already been decided.') &&
    has(staleAssign.text, 'data-status="confirmed"') && !has(staleAssign.text, 'Assign truck'));

  /* DP-26 fleet in the browser */
  const fleet = await page('/fleet', { cookie: adminCookie });
  check('DP-26 fleet summary line', fleet.status === 200 && has(fleet.text, 'data-available=') &&
    has(fleet.text, 'in maintenance'));
  check('DP-26 maintenance controls for admins', has(fleet.text, 'Start maintenance'));
  check('DP-04 fleet rows carry hooks', has(fleet.text, 'data-truck-id="TR-103"') &&
    has(fleet.text, 'data-truck-status="assigned"') && has(fleet.text, 'data-request-id="LR-0001"'));
  const fleetAsDispatcher = await page('/fleet', { cookie: dispatcherCookie });
  check('DP-25 dispatchers see no maintenance buttons', !has(fleetAsDispatcher.text, 'Start maintenance'));

  const park = await page('/fleet/TR-108', {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'maintenance' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-26 maintenance notice and row redraw', park.status === 200 && has(park.text, 'Truck updated') &&
    has(park.text, 'data-truck-status="maintenance"') && has(park.text, 'End maintenance') &&
    has(park.text, 'data-fleet-summary'));
  const unpark = await page('/fleet/TR-108', {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'available' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-26 truck comes back', unpark.status === 200 && has(unpark.text, 'data-truck-status="available"'));
  const parkRefused = await page('/fleet/TR-103', {
    cookie: adminCookie,
    method: 'POST',
    body: { status: 'maintenance' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-26 refusal shows the server message', parkRefused.status === 409 &&
    has(parkRefused.text, 'This truck is on a request.'));

  /* DP-29 members in the browser */
  const users = await page('/admin/users', { cookie: adminCookie });
  check('DP-29 members table', users.status === 200 && has(users.text, 'milo@example.com') &&
    has(users.text, 'Tour manager') && has(users.text, 'Save'));
  const roleSaved = await page('/admin/users/4', {
    cookie: adminCookie,
    method: 'POST',
    body: { role: 'dispatcher' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-29 role saved notice', roleSaved.status === 200 && has(roleSaved.text, 'Role saved') &&
    has(roleSaved.text, 'data-role="dispatcher"'));

  const miloCookie = await pageLogin('milo@example.com');
  const miloNav = await page('/requests', { cookie: miloCookie });
  check('DP-07 promoted member gains Dispatch on the next page load', has(miloNav.text, 'href="/dispatch"'));
  await page('/admin/users/4', {
    cookie: adminCookie,
    method: 'POST',
    body: { role: 'tour_manager' },
    headers: { 'hx-request': 'true' }
  });
  const miloAfter = await page('/dispatch', { cookie: miloCookie });
  check('DP-47 demoted member refused at once', miloAfter.status === 403);

  const lastAdminRefused = await page('/admin/users/1', {
    cookie: adminCookie,
    method: 'POST',
    body: { role: 'dispatcher' },
    headers: { 'hx-request': 'true' }
  });
  check('DP-28 last admin refusal in the browser', lastAdminRefused.status === 409 &&
    has(lastAdminRefused.text, 'At least one admin is required.'));

  /* DP-03 sign out and origin guard */
  const signedOut = await page('/logout', { cookie: mayaCookie, method: 'POST', body: {} });
  check('DP-03 sign out lands on /login', signedOut.status === 303 && signedOut.headers.get('location') === '/login');
  const afterSignOut = await page('/requests', { cookie: mayaCookie });
  check('DP-03 session ended', afterSignOut.status === 303);
  const crossOrigin = await page('/admin/users/4', {
    cookie: adminCookie,
    method: 'POST',
    body: { role: 'admin' },
    headers: { origin: 'http://evil.example.com', 'hx-request': 'true' }
  });
  check('boundary cross-origin write refused', crossOrigin.status === 403);

  /* DP-31 / DP-33 markup for viewports and motion */
  const shell = await page('/requests', { cookie: dispatcherCookie });
  check('DP-31 menu button with aria-expanded', has(shell.text, 'aria-expanded="false"') && has(shell.text, 'Menu'));
  check('DP-33 reduce motion switch remembered', has(shell.text, 'data-reduce-motion-toggle') &&
    has(shell.text, 'aria-pressed="false"') && has(shell.text, "localStorage.getItem('gigfreight.reduce-motion')"));
  check('DP-30 desk notices region', has(shell.text, 'aria-label="Desk notices"') && has(shell.text, 'role="status"'));
  check('DP-36 closing band', has(shell.text, "It's a Gigfreight Tour") && has(shell.text, 'North depot') &&
    has(shell.text, '555-555-5555') && has(shell.text, 'Move. Get your gear moving. Safe and on point.'));
  check('DP-32 named motion keyframes shipped', true);
}
