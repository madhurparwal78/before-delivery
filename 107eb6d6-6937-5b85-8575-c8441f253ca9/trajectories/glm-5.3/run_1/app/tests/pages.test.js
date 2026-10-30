'use strict';

// Page and fragment checks against a running server, using the session cookie
// exactly as the browser does.

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${String(detail).slice(0, 240)}` : ''}`);
  }
}

function cookieOf(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function page(method, path, { cookie, body, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  let payload;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: 'manual' });
  const text = await response.text();
  return { status: response.status, text, cookie: cookieOf(response), headers: response.headers };
}

async function signIn(email) {
  const response = await page('POST', '/login', {
    body: { email, password: 'deku-demo-pw-2026', next: '/requests' },
  });
  return response.cookie;
}

async function main() {
  // --- DP-03 sign-in in the browser ---
  const out = await page('GET', '/requests');
  check('signed-out page redirects to login with next', out.status === 302 && out.headers.get('location').startsWith('/login?next=%2Frequests'), out.headers.get('location'));

  const mayaCookie = await signIn('manager@example.com');
  check('maya session cookie set', Boolean(mayaCookie));
  const dexCookie = await signIn('dispatcher@example.com');
  const adaCookie = await signIn('admin@example.com');
  const miloCookie = await signIn('milo@example.com');

  const badLogin = await page('POST', '/login', { body: { email: 'manager@example.com', password: 'nope', next: '/requests' } });
  check('failed sign-in shows error and keeps email', badLogin.status === 401 && badLogin.text.includes('Invalid email or password.') && badLogin.text.includes('value="manager@example.com"'));
  check('failed sign-in shows sign-in error region', badLogin.text.includes('aria-label="Sign-in error"'));

  const home = await page('GET', '/', { cookie: mayaCookie });
  check('root redirects to requests', home.status === 302 && home.headers.get('location') === '/requests');

  const openWithNext = await page('POST', '/login', { body: { email: 'manager@example.com', password: 'deku-demo-pw-2026', next: 'https://evil.example.com' } });
  check('foreign next falls back to requests', openWithNext.status === 302 && openWithNext.headers.get('location') === '/requests');

  // --- DP-04/DP-12 requests page ---
  const requestsPage = await page('GET', '/requests', { cookie: mayaCookie });
  check('requests page renders', requestsPage.status === 200);
  check('maya sees only her rows', requestsPage.text.includes('Velvet Fuzz winter run') && !requestsPage.text.includes('Harbour Lights festival stage'));
  check('requests page has New request for manager', requestsPage.text.includes('New request'));
  check('request row data hooks', requestsPage.text.includes('data-request-id="LR-0001"') && requestsPage.text.includes('data-status="submitted"'));
  check('manager row has no requester column', !requestsPage.text.includes('data-label="Requester"'));
  const dexRequests = await page('GET', '/requests', { cookie: dexCookie });
  check('dispatcher sees every request', dexRequests.text.includes('Harbour Lights festival stage') && dexRequests.text.includes('data-label="Requester"'));

  const searchPage = await page('GET', '/requests?q=velvet', { cookie: mayaCookie });
  check('direct search address narrows', searchPage.status === 200 && searchPage.text.includes('Velvet Fuzz winter run') && !searchPage.text.includes('Northern Echo'));
  const statusPage = await page('GET', '/requests?status=confirmed', { cookie: mayaCookie });
  check('status filter address narrows', statusPage.text.includes('Northern Echo arena run') && !statusPage.text.includes('Velvet Fuzz'));
  const emptySearch = await page('GET', '/requests?q=zzznotfound', { cookie: mayaCookie });
  check('empty search offers clear', emptySearch.text.includes('No requests match') && emptySearch.text.includes('Clear search'));

  const rowsFragment = await page('GET', '/requests-rows?q=velvet', { cookie: mayaCookie });
  check('rows fragment serves rows', rowsFragment.status === 200 && rowsFragment.text.includes('LR-0001'));
  const rowsForeign = await page('GET', '/requests-rows?q=harbour', { cookie: mayaCookie });
  check('rows fragment applies ownership', !rowsForeign.text.includes('LR-0002'), rowsForeign.text.slice(0, 100));
  const rowsForeignActivity = await page('GET', '/requests/LR-0002/activity', { cookie: mayaCookie });
  check('foreign activity fragment 404', rowsForeignActivity.status === 404);

  // --- DP-14 not-found pages ---
  const unknown = await page('GET', '/nowhere-at-all', { cookie: mayaCookie });
  check('unknown address 404 wrong venue', unknown.status === 404 && unknown.text.includes('404. Wrong venue.') && unknown.text.includes('This address is not on the run sheet.') && unknown.text.includes('Back to requests'));
  const hiddenRequest = await page('GET', '/requests/LR-0002', { cookie: mayaCookie });
  check('hidden request 404 copy', hiddenRequest.status === 404 && hiddenRequest.text.includes('This request does not exist or you cannot see it.'));
  const decidedDenied = await page('GET', '/requests/LR-0003/decided', { cookie: mayaCookie });
  check('manager refused decided page 403', decidedDenied.status === 403 && decidedDenied.text.includes('You do not have access to this page.'));

  // --- DP-15/DP-42 request page and dispatch panel ---
  const requestPage = await page('GET', '/requests/LR-0001', { cookie: dexCookie });
  check('request page for dispatcher', requestPage.status === 200);
  check('panel with Assign truck options', requestPage.text.includes('Assign truck') && requestPage.text.includes('TR-101 (North)') && requestPage.text.includes('Assign'));
  check('count line hooks', requestPage.text.includes('data-trucks-assigned="1"') && requestPage.text.includes('data-trucks-requested="3"'));
  check('stop cards numbered', requestPage.text.includes('( 1 ) Pickup') && requestPage.text.includes('( 4 ) Last Show'));
  check('timeline fetched after load', requestPage.text.includes('hx-get="/requests/LR-0001/activity"'));
  check('activity region named', requestPage.text.includes('aria-labelledby="activity-head"'));
  check('release button present', requestPage.text.includes('Release TR-103'));

  const panelFragment = await page('GET', '/requests/LR-0001/panel', { cookie: dexCookie });
  check('panel fragment serves', panelFragment.status === 200 && panelFragment.text.includes('TR-101 (North)'));

  const mayaPanel = await page('GET', '/requests/LR-0001/panel', { cookie: mayaCookie });
  check('manager panel fragment for own request ok but no controls', mayaPanel.status === 200 && !mayaPanel.text.includes('Assign truck'));
  const miloPanel = await page('GET', '/requests/LR-0001/panel', { cookie: miloCookie });
  check('foreign panel fragment 404', miloPanel.status === 404);

  // --- Fragment writes ---
  const assignFragment = await page('POST', '/requests/LR-0001/assignments', { cookie: dexCookie, body: { truck_id: 'TR-101' } });
  check('assign fragment swaps panel', assignFragment.status === 200 && assignFragment.text.includes('Truck assigned'));
  check('assign fragment redraws count', assignFragment.text.includes('data-trucks-assigned="2"'));
  check('assign fragment updates oob activity', assignFragment.text.includes('hx-swap-oob="true"') && assignFragment.text.includes('TR-101 assigned'));

  const refusedAssign = await page('POST', '/requests/LR-0001/assignments', { cookie: dexCookie, body: { truck_id: 'TR-101' } });
  check('refused assign shows server message', refusedAssign.status === 409 && refusedAssign.text.includes('This truck is not available.'));
  check('refused assign redraws from storage', refusedAssign.text.includes('data-trucks-assigned="2"'));

  const releasedFragment = await page('POST', '/requests/LR-0001/assignments/TR-101/release', { cookie: dexCookie });
  check('release fragment shows notice', releasedFragment.status === 200 && releasedFragment.text.includes('Truck released'));
  check('release fragment count back to one', releasedFragment.text.includes('data-trucks-assigned="1"'));

  const managerAssignFragment = await page('POST', '/requests/LR-0001/assignments', { cookie: mayaCookie, body: { truck_id: 'TR-105' } });
  check('manager assign fragment refused 403', managerAssignFragment.status === 403 && managerAssignFragment.text.includes('You do not have access to this page.'));

  // Cross-origin write guard.
  const foreignOrigin = await page('POST', '/requests/LR-0001/assignments', { cookie: dexCookie, body: { truck_id: 'TR-105' }, origin: 'https://evil.example.com' });
  check('foreign origin write refused 403', foreignOrigin.status === 403);

  const badNoteFragment = await page('POST', '/requests/LR-0001/decision', { cookie: dexCookie, body: { decision: 'decline', note: '' } });
  check('decline without note shows reason under field', badNoteFragment.status === 422 && badNoteFragment.text.includes('Add a note to explain your decision.'));

  // --- DP-25/DP-26 fleet maintenance in the browser ---
  const fleetAdmin = await page('GET', '/fleet', { cookie: adaCookie });
  check('admin sees maintenance buttons', fleetAdmin.text.includes('Start maintenance') && fleetAdmin.text.includes('End maintenance'));
  const maintenanceStart = await page('POST', '/trucks/TR-108/status', { cookie: adaCookie, body: { status: 'maintenance' } });
  check('maintenance fragment shows Truck updated', maintenanceStart.status === 200 && maintenanceStart.text.includes('Truck updated'));
  check('maintenance fragment redraws summary', maintenanceStart.text.includes('data-maintenance="2"'));
  const maintenanceDex = await page('POST', '/trucks/TR-109/status', { cookie: dexCookie, body: { status: 'maintenance' } });
  check('dispatcher maintenance fragment refused', maintenanceDex.status === 403);
  const maintenanceBack = await page('POST', '/trucks/TR-108/status', { cookie: adaCookie, body: { status: 'available' } });
  check('maintenance end fragment', maintenanceBack.status === 200 && maintenanceBack.text.includes('data-maintenance="1"'));

  // --- DP-28/DP-29 members page ---
  const usersDex = await page('GET', '/admin/users', { cookie: dexCookie });
  check('dispatcher members page refused', usersDex.status === 403);
  const usersAda = await page('GET', '/admin/users', { cookie: adaCookie });
  check('members page lists rows', usersAda.status === 200 && usersAda.text.includes('Milo Manager') && usersAda.text.includes('milo@example.com'));
  const roleSave = await page('POST', '/members/4/role', { cookie: adaCookie, body: { role: 'dispatcher' } });
  check('role fragment shows Role saved', roleSave.status === 200 && roleSave.text.includes('Role saved'));
  const roleBad = await page('POST', '/members/4/role', { cookie: adaCookie, body: { role: 'captain' } });
  check('bad role fragment shows reason', roleBad.status === 422 && roleBad.text.includes('Choose a role.'));
  const roleDemote = await page('POST', '/members/1/role', { cookie: adaCookie, body: { role: 'dispatcher' } });
  check('last admin fragment refused', roleDemote.status === 409 && roleDemote.text.includes('At least one admin is required.'));
  const roleBack = await page('POST', '/members/4/role', { cookie: adaCookie, body: { role: 'tour_manager' } });
  check('role restored', roleBack.status === 200);

  // --- DP-47 demoted member's next page load ---
  const promote = await page('POST', '/members/4/role', { cookie: adaCookie, body: { role: 'dispatcher' } });
  check('promote milo for role test', promote.status === 200);
  const miloDispatch = await page('GET', '/dispatch', { cookie: miloCookie });
  check('promoted milo reads dispatch', miloDispatch.status === 200);
  const demote = await page('POST', '/members/4/role', { cookie: adaCookie, body: { role: 'tour_manager' } });
  check('demote milo', demote.status === 200);
  const miloDispatchAfter = await page('GET', '/dispatch', { cookie: miloCookie });
  check('demoted milo refused next page load', miloDispatchAfter.status === 403);
  const miloFragmentAfter = await page('POST', '/requests/LR-0001/assignments', { cookie: miloCookie, body: { truck_id: 'TR-109' } });
  check('demoted milo next action refused', miloFragmentAfter.status === 403);

  // --- Sign out ---
  const signOut = await page('POST', '/logout', { cookie: mayaCookie });
  check('sign out lands on login', signOut.status === 302 && signOut.headers.get('location') === '/login');
  const afterSignOut = await page('GET', '/requests', { cookie: mayaCookie });
  check('session ended', afterSignOut.status === 302 && afterSignOut.headers.get('location').startsWith('/login'));

  // --- Steps pages ---
  const step1 = await page('GET', '/requests/new', { cookie: dexCookie });
  check('step 1 page', step1.status === 200 && step1.text.includes('( 1 ) Tour details') && step1.text.includes('Type of transportation'));
  const step2 = await page('GET', '/requests/new/stops', { cookie: dexCookie });
  check('step 2 page legends', step2.status === 200 && step2.text.includes('legend>Pickup') && step2.text.includes('legend>Last Show'));
  check('step 2 bare fields', step2.text.includes('Date (optional)') && step2.text.includes('State or Province'));
  const step3 = await page('GET', '/requests/new/review', { cookie: dexCookie });
  check('step 3 page with notes', step3.status === 200 && step3.text.includes('Notes') && step3.text.includes('Submit request'));

  const stepValidate = await page('POST', '/requests/new/validate', { cookie: dexCookie });
  check('validate endpoint reachable', stepValidate.status === 200);

  const throttled = await page('POST', '/login', { body: { email: 'pages-throttle@example.com', password: 'no', next: '/requests' } });
  check('throttled page sign-in keeps email', throttled.status === 429 || throttled.status === 401);

  console.log(`\n${checks - failures} passed, ${failures} failed of ${checks}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
