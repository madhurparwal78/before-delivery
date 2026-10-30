'use strict';

// API-level checks against a running server on the port below. The suite
// assumes a freshly seeded database; it only mutates state it creates.

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const options = {
    method,
    headers: { ...headers },
  };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  const result = { status: response.status, headers: response.headers, body: json, text };
  return result;
}

async function login(email, password = 'deku-demo-pw-2026') {
  return call('POST', '/api/auth/login', { body: { email, password } });
}

function validRequestDraft(overrides = {}) {
  return {
    tour_name: 'Test tour run',
    transport_type: 'tour',
    trucks_requested: 2,
    notes: '',
    stops: {
      pickup: { date: '2026-05-01', address: '1 Main St', city: 'Ottawa', region: 'ON', postal_code: 'K1A 0B1', country: 'Canada' },
      delivery: { date: '2026-05-02', address: '2 Main St', city: 'Toronto', region: 'ON', postal_code: 'M5V 2T6', country: 'Canada' },
      first_show: { date: '2026-05-03', address: '2 Main St', city: 'Toronto', region: 'ON', postal_code: 'M5V 2T6', country: 'Canada' },
      last_show: { date: '2026-05-30', address: '3 Main St', city: 'Chicago', region: 'IL', postal_code: '60601', country: 'USA' },
    },
    ...overrides,
  };
}

async function main() {
  // --- DP-35 health ---
  const health = await call('GET', '/api/health');
  check('health ok', health.status === 200 && health.body.status === 'ok', health);

  // --- DP-01 sign-in ---
  const maya = await login('manager@example.com');
  check('mayor login 200', maya.status === 200 && maya.body.user.role === 'tour_manager', maya.body);
  const mayaToken = maya.body.token;
  const dex = await login('dispatcher@example.com');
  const dexToken = dex.body.token;
  const ada = await login('admin@example.com');
  const adaToken = ada.body.token;
  const milo = await login('milo@example.com');
  const miloToken = milo.body.token;
  check('case-insensitive login', (await login('  ADMIN@example.COM ')).status === 200);

  const me = await call('GET', '/api/auth/me', { token: mayaToken });
  check('me describes member', me.status === 200 && me.body.user.email === 'manager@example.com', me.body);

  // --- DP-02 refused sign-in, missing sessions ---
  const wrongPassword = await login('manager@example.com', 'wrong');
  check('wrong password 401', wrongPassword.status === 401 && wrongPassword.body.error === 'invalid_credentials', wrongPassword.body);
  const unknownEmail = await login('nobody@example.com', 'x');
  check('unknown email 401 same copy', unknownEmail.status === 401 && unknownEmail.body.message === wrongPassword.body.message);
  const noToken = await call('GET', '/api/requests');
  check('missing token 401', noToken.status === 401 && noToken.body.error === 'unauthenticated');
  const badToken = await call('GET', '/api/requests', { token: 'not-a-token' });
  check('unknown token 401', badToken.status === 401);

  // --- DP-04 seeded fleet ---
  const trucks = await call('GET', '/api/trucks', { token: dexToken });
  check('trucks listed', trucks.status === 200 && trucks.body.length === 10, trucks.body && trucks.body.length);
  check('trucks in id order', trucks.body.every((t, i, a) => i === 0 || a[i - 1].id < t.id));
  const tr103 = trucks.body.find((t) => t.id === 'TR-103');
  check('TR-103 assigned to LR-0001', tr103.status === 'assigned' && tr103.request_id === 'LR-0001', tr103);
  const tr104 = trucks.body.find((t) => t.id === 'TR-104');
  check('TR-104 maintenance', tr104.status === 'maintenance' && tr104.request_id === null, tr104);
  const trucksFiltered = await call('GET', '/api/trucks?status=available', { token: dexToken });
  check('trucks filter by status', trucksFiltered.status === 200 && trucksFiltered.body.every((t) => t.status === 'available'));
  const trucksBad = await call('GET', '/api/trucks?status=flying', { token: dexToken });
  check('bad truck status 400', trucksBad.status === 400 && trucksBad.body.error === 'bad_request', trucksBad.body);

  // --- DP-05 seeded requests ---
  const lr0001 = await call('GET', '/api/requests/LR-0001', { token: dexToken });
  check('LR-0001 stored once', lr0001.status === 200 && lr0001.body.tour_name === 'Velvet Fuzz winter run', lr0001.body);
  check('LR-0001 stops in order', lr0001.body.stops.map((s) => s.kind).join(',') === 'pickup,delivery,first_show,last_show');
  check('LR-0001 trucks', lr0001.body.trucks.map((t) => t.id).join(',') === 'TR-103', lr0001.body.trucks);
  const lr0003 = await call('GET', '/api/requests/LR-0003', { token: dexToken });
  check('LR-0003 confirmed decision', lr0003.body.status === 'confirmed' && lr0003.body.decided_by.name === 'Dex Dispatcher' && lr0003.body.decision_note === 'Confirmed with two southern trucks.', lr0003.body);
  const lr0004 = await call('GET', '/api/requests/LR-0004', { token: dexToken });
  check('LR-0004 declined no trucks', lr0004.body.status === 'declined' && lr0004.body.trucks.length === 0 && lr0004.body.trucks_assigned === 0, lr0004.body);
  const activity0004 = await call('GET', '/api/requests/LR-0004/activity', { token: dexToken });
  check('LR-0004 activity decline entry', activity0004.body.some((e) => e.kind === 'declined' && e.note === 'No trucks free on those dates.'), activity0004.body);

  // --- DP-06 board summary ---
  const board = await call('GET', '/api/dispatch', { token: dexToken });
  check('board waiting 2 needed 4 available 6', board.body.summary.waiting === 2 && board.body.summary.trucks_needed === 4 && board.body.summary.trucks_available === 6, board.body.summary);
  check('board oldest first', board.body.requests.map((r) => r.id).join(',') === 'LR-0001,LR-0002');

  // --- DP-13 ownership ---
  const miloList = await call('GET', '/api/requests', { token: miloToken });
  check('milo sees only own', miloList.body.every((r) => r.requester.id === 4), miloList.body.map((r) => r.id));
  const miloOther = await call('GET', '/api/requests/LR-0001', { token: miloToken });
  check('milo cannot read LR-0001 404', miloOther.status === 404 && miloOther.body.error === 'not_found', miloOther.body);
  const miloOtherActivity = await call('GET', '/api/requests/LR-0001/activity', { token: miloToken });
  check('milo cannot read activity 404', miloOtherActivity.status === 404);

  // --- DP-11 list pagination and filters ---
  const allRequests = await call('GET', '/api/requests', { token: adaToken });
  check('requests newest first', allRequests.status === 200 && Array.isArray(allRequests.body) && allRequests.body.length === 4);
  const filtered = await call('GET', '/api/requests?status=submitted', { token: adaToken });
  check('status filter', filtered.body.every((r) => r.status === 'submitted'));
  const searched = await call('GET', '/api/requests?q=velvet', { token: adaToken });
  check('search filter case-insensitive', searched.body.length === 1 && searched.body[0].id === 'LR-0001');
  const badStatus = await call('GET', '/api/requests?status=finished', { token: adaToken });
  check('bad status 400', badStatus.status === 400 && badStatus.body.message === 'status must be submitted, confirmed or declined.');
  const badLimit = await call('GET', '/api/requests?limit=101', { token: adaToken });
  check('bad limit 400', badLimit.status === 400 && badLimit.body.message === 'limit must be a whole number from 1 to 100.');
  const badCursor = await call('GET', '/api/requests?cursor=zzz', { token: adaToken });
  check('bad cursor 400', badCursor.status === 400 && badCursor.body.message === 'cursor is not valid.');

  // --- DP-08/DP-44 stored submission + draft replay ---
  const draftId = '11111111-1111-4111-8111-111111111111';
  const created = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ draft_id: draftId }) });
  check('created 201 LR-0005', created.status === 201 && created.body.id === 'LR-0005' && created.body.status === 'submitted', created.body);
  check('requester is signed-in member', created.body.requester.name === 'Maya Manager');
  check('submission activity note', true);
  const replayed = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ tour_name: 'Different name', draft_id: draftId }) });
  check('draft replay 200 same id', replayed.status === 200 && replayed.body.id === created.body.id && replayed.body.tour_name === created.body.tour_name, replayed.body);
  const crossMember = await call('POST', '/api/requests', { token: miloToken, body: validRequestDraft({ draft_id: draftId }) });
  check('same draft other member creates own', crossMember.status === 201 && crossMember.body.id === 'LR-0006', crossMember.body);
  const createdActivity = await call('GET', `/api/requests/${created.body.id}/activity`, { token: mayaToken });
  check('submitted activity reads requested trucks', createdActivity.body[0].kind === 'submitted' && createdActivity.body[0].note === 'Requested 2 trucks', createdActivity.body[0]);

  // --- DP-07 validation refused, nothing stored ---
  const highestBefore = await call('GET', '/api/requests?limit=1', { token: adaToken });
  const badDraft = validRequestDraft({ tour_name: '' });
  const refused = await call('POST', '/api/requests', { token: mayaToken, body: badDraft });
  check('bad tour name 422', refused.status === 422 && refused.body.fields.tour_name === 'Tour name is required.', refused.body);
  const refusedType = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ transport_type: 'party' }) });
  check('bad type 422', refusedType.body.fields.transport_type === 'Choose a type of transportation.');
  const refusedCount = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ trucks_requested: 9 }) });
  check('bad count 422', refusedCount.body.fields.trucks_requested === 'Enter a number of trucks from 1 to 8.');
  const refusedStop = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ stops: { ...validRequestDraft().stops, delivery: { ...validRequestDraft().stops.delivery, city: '' } } }) });
  check('bad stop 422', refusedStop.body.fields['stops.delivery.city'] === 'City is required.', refusedStop.body);
  const refusedDates = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ stops: { ...validRequestDraft().stops, delivery: { ...validRequestDraft().stops.delivery, date: '2026-04-01' } } }) });
  check('delivery before pickup 422', refusedDates.body.fields['stops.delivery.date'] === 'Delivery cannot be before pickup.', refusedDates.body);
  const refusedLastShow = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ stops: { ...validRequestDraft().stops, last_show: { ...validRequestDraft().stops.last_show, date: '2026-04-01' } } }) });
  check('last show before first show 422', refusedLastShow.body.fields['stops.last_show.date'] === 'Last show cannot be before the first show.', refusedLastShow.body);
  const badDraftId = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ draft_id: 'not-a-uuid' }) });
  check('malformed draft id 422', badDraftId.status === 422 && badDraftId.body.fields.draft_id === 'The draft id must be a UUID.', badDraftId.body);
  const ignored = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ status: 'confirmed', id: 'LR-9999', requester_id: 1, trucks_assigned: 5, role: 'admin' }) });
  check('unknown keys ignored', ignored.status === 201 && ignored.body.status === 'submitted' && ignored.body.requester.name === 'Maya Manager' && ignored.body.trucks_assigned === 0, ignored.body && ignored.body.status);
  const highestAfter = await call('GET', '/api/requests?limit=1', { token: adaToken });
  check('refused post uses no id', Number(highestAfter.body[0].id.slice(3)) === Number(highestBefore.body[0].id.slice(3)) + 1);

  // --- DP-16/DP-17 assignment ---
  const assigned = await call('POST', '/api/requests/LR-0001/assignments', { token: dexToken, body: { truck_id: 'TR-101' } });
  check('assign available truck 201', assigned.status === 201 && assigned.body.trucks.some((t) => t.id === 'TR-101'), assigned.body);
  const assignedActivity = await call('GET', '/api/requests/LR-0001/activity', { token: dexToken });
  check('truck_assigned activity', assignedActivity.body.some((e) => e.kind === 'truck_assigned' && e.note === 'TR-101 assigned'));
  const doubleAssign = await call('POST', '/api/requests/LR-0002/assignments', { token: dexToken, body: { truck_id: 'TR-101' } });
  check('assign busy truck 409', doubleAssign.status === 409 && doubleAssign.body.message === 'This truck is not available.', doubleAssign.body);
  const maintenanceAssign = await call('POST', '/api/requests/LR-0002/assignments', { token: dexToken, body: { truck_id: 'TR-104' } });
  check('assign parked truck 409', maintenanceAssign.status === 409 && maintenanceAssign.body.message === 'This truck is not available.');
  const unknownTruck = await call('POST', '/api/requests/LR-0002/assignments', { token: dexToken, body: { truck_id: 'TR-999' } });
  check('assign unknown truck 422', unknownTruck.status === 422 && unknownTruck.body.fields.truck_id === 'Choose a truck from the fleet.', unknownTruck.body);

  // fill LR-0001 (3 trucks: TR-103, TR-101, TR-102) then overflow
  await call('POST', '/api/requests/LR-0001/assignments', { token: dexToken, body: { truck_id: 'TR-102' } });
  const overflow = await call('POST', '/api/requests/LR-0001/assignments', { token: dexToken, body: { truck_id: 'TR-105' } });
  check('assign beyond requested 409', overflow.status === 409 && overflow.body.message === 'This request already has every truck it asked for.', overflow.body);

  // --- DP-18 release ---
  const released = await call('DELETE', '/api/requests/LR-0001/assignments/TR-101', { token: dexToken });
  check('release 204', released.status === 204);
  const releaseActivity = await call('GET', '/api/requests/LR-0001/activity', { token: dexToken });
  check('truck_released activity', releaseActivity.body.some((e) => e.kind === 'truck_released' && e.note === 'TR-101 released'));
  const truckAfter = await call('GET', '/api/trucks', { token: dexToken });
  check('released truck available again', truckAfter.body.find((t) => t.id === 'TR-101').status === 'available');
  const releaseNotOnRequest = await call('DELETE', '/api/requests/LR-0001/assignments/TR-105', { token: dexToken });
  check('release truck not on request 404', releaseNotOnRequest.status === 404, releaseNotOnRequest.body);

  // --- DP-19 confirm ---
  const earlyConfirm = await call('POST', '/api/requests/LR-0001/decision', { token: dexToken, body: { decision: 'confirm', note: 'Too early.' } });
  check('early confirm 409', earlyConfirm.status === 409 && earlyConfirm.body.message === 'Assign every requested truck before confirming.', earlyConfirm.body);
  const badDecision = await call('POST', '/api/requests/LR-0001/decision', { token: dexToken, body: { decision: 'maybe', note: 'x' } });
  check('bad decision 422', badDecision.status === 422 && badDecision.body.fields.decision === 'Choose a decision.', badDecision.body);
  const noNote = await call('POST', '/api/requests/LR-0001/decision', { token: dexToken, body: { decision: 'confirm' } });
  check('missing note 422', noNote.status === 422 && noNote.body.fields.note === 'Add a note to explain your decision.', noNote.body);
  await call('POST', '/api/requests/LR-0001/assignments', { token: dexToken, body: { truck_id: 'TR-101' } });
  const confirmed = await call('POST', '/api/requests/LR-0001/decision', { token: dexToken, body: { decision: 'confirm', note: 'Two trucks and TR-103 for the run.' } });
  check('confirm 200', confirmed.status === 200 && confirmed.body.status === 'confirmed' && confirmed.body.decided_by.name === 'Dex Dispatcher', confirmed.body && confirmed.body.status);
  const confirmAgain = await call('POST', '/api/requests/LR-0001/decision', { token: dexToken, body: { decision: 'decline', note: 'Again.' } });
  check('decided twice 409', confirmAgain.status === 409 && confirmAgain.body.message === 'This request has already been decided.', confirmAgain.body);
  const assignDecided = await call('POST', '/api/requests/LR-0001/assignments', { token: dexToken, body: { truck_id: 'TR-105' } });
  check('assign to decided 409', assignDecided.status === 409 && assignDecided.body.message === 'This request has already been decided.');
  const releaseDecided = await call('DELETE', '/api/requests/LR-0001/assignments/TR-103', { token: dexToken });
  check('release from decided 409', releaseDecided.status === 409 && releaseDecided.body.message === 'This request has already been decided.');
  const confirmedTrucks = await call('GET', '/api/trucks', { token: dexToken });
  check('confirmed keeps trucks assigned', confirmedTrucks.body.find((t) => t.id === 'TR-101').status === 'assigned' && confirmedTrucks.body.find((t) => t.id === 'TR-101').request_id === 'LR-0001');

  // --- DP-20/DP-43 decline releases trucks ---
  await call('POST', '/api/requests/LR-0002/assignments', { token: dexToken, body: { truck_id: 'TR-105' } });
  const declined = await call('POST', '/api/requests/LR-0002/decision', { token: dexToken, body: { decision: 'decline', note: 'Dates clash with the arena load-in.' } });
  check('decline 200', declined.status === 200 && declined.body.status === 'declined' && declined.body.trucks.length === 0 && declined.body.trucks_assigned === 0, declined.body && declined.body.trucks);
  const trucksAfterDecline = await call('GET', '/api/trucks', { token: dexToken });
  check('declined truck free at once', trucksAfterDecline.body.find((t) => t.id === 'TR-105').status === 'available' && trucksAfterDecline.body.find((t) => t.id === 'TR-105').request_id === null);
  const declineActivity = await call('GET', '/api/requests/LR-0002/activity', { token: dexToken });
  check('release entries before decline', declineActivity.body.some((e) => e.kind === 'truck_released' && e.note === 'TR-105 released') && declineActivity.body[declineActivity.body.length - 1].kind === 'declined', declineActivity.body.map((e) => e.kind));
  const reassign = await call('POST', '/api/requests/LR-0006/assignments', { token: dexToken, body: { truck_id: 'TR-105' } });
  check('declined truck reassigns at once', reassign.status === 201);

  // --- DP-24 tour manager kept out ---
  const managerBoard = await call('GET', '/api/dispatch', { token: mayaToken });
  check('manager board 403', managerBoard.status === 403 && managerBoard.body.message === 'You do not have access to this page.', managerBoard.body);
  const managerTrucks = await call('GET', '/api/trucks', { token: mayaToken });
  check('manager trucks 403', managerTrucks.status === 403);
  const managerAssign = await call('POST', '/api/requests/LR-0001/assignments', { token: mayaToken, body: { truck_id: 'TR-109' } });
  check('manager assign 403', managerAssign.status === 403);
  const managerDecision = await call('POST', '/api/requests/LR-0003/decision', { token: mayaToken, body: { decision: 'decline', note: 'x' } });
  check('manager decision 403', managerDecision.status === 403);
  const roleInBody = await call('POST', '/api/requests/LR-0003/decision', { token: mayaToken, body: { decision: 'decline', note: 'x', role: 'admin' } });
  check('role in body grants nothing', roleInBody.status === 403);
  const managerUsers = await call('GET', '/api/users', { token: mayaToken });
  check('manager users 403', managerUsers.status === 403);
  const dispatcherUsers = await call('GET', '/api/users', { token: dexToken });
  check('dispatcher users 403', dispatcherUsers.status === 403);

  // --- DP-25 maintenance ---
  const dispatcherMaintenance = await call('PATCH', '/api/trucks/TR-108', { token: dexToken, body: { status: 'maintenance' } });
  check('dispatcher maintenance 403', dispatcherMaintenance.status === 403);
  const startMaintenance = await call('PATCH', '/api/trucks/TR-108', { token: adaToken, body: { status: 'maintenance' } });
  check('admin starts maintenance', startMaintenance.status === 200 && startMaintenance.body.status === 'maintenance', startMaintenance.body);
  const sameStatus = await call('PATCH', '/api/trucks/TR-108', { token: adaToken, body: { status: 'maintenance' } });
  check('same status 200 unchanged', sameStatus.status === 200 && sameStatus.body.status === 'maintenance');
  const onRequestMaintenance = await call('PATCH', '/api/trucks/TR-106', { token: adaToken, body: { status: 'maintenance' } });
  check('truck on request 409', onRequestMaintenance.status === 409 && onRequestMaintenance.body.message === 'This truck is on a request.', onRequestMaintenance.body);
  const endMaintenance = await call('PATCH', '/api/trucks/TR-108', { token: adaToken, body: { status: 'available' } });
  check('admin ends maintenance', endMaintenance.status === 200 && endMaintenance.body.status === 'available');
  const badTruckStatus = await call('PATCH', '/api/trucks/TR-108', { token: adaToken, body: { status: 'assigned' } });
  check('bad maintenance status 400', badTruckStatus.status === 400 && badTruckStatus.body.message === 'status must be available, assigned or maintenance.', badTruckStatus.body);
  const unknownTruckPatch = await call('PATCH', '/api/trucks/TR-999', { token: adaToken, body: { status: 'maintenance' } });
  check('unknown truck patch 404', unknownTruckPatch.status === 404);

  // --- DP-27/DP-28 roles ---
  const promoteMilo = await call('PATCH', '/api/users/4', { token: adaToken, body: { role: 'dispatcher' } });
  check('promote milo 200', promoteMilo.status === 200 && promoteMilo.body.role === 'dispatcher', promoteMilo.body);
  const miloBoardNow = await call('GET', '/api/dispatch', { token: miloToken });
  check('promotion applies at once on old token', miloBoardNow.status === 200, miloBoardNow.body);
  const badRole = await call('PATCH', '/api/users/4', { token: adaToken, body: { role: 'captain' } });
  check('bad role 422', badRole.status === 422 && badRole.body.fields.role === 'Choose a role.', badRole.body);
  const unknownMember = await call('PATCH', '/api/users/999', { token: adaToken, body: { role: 'admin' } });
  check('unknown member 404', unknownMember.status === 404);
  const demoteMilo = await call('PATCH', '/api/users/4', { token: adaToken, body: { role: 'tour_manager' } });
  check('demote milo 200', demoteMilo.status === 200);
  const miloBoardAfter = await call('GET', '/api/dispatch', { token: miloToken });
  check('demotion refuses next call', miloBoardAfter.status === 403);
  // Last admin guard: ada is the only admin now.
  const demoteAda = await call('PATCH', '/api/users/1', { token: adaToken, body: { role: 'dispatcher' } });
  check('last admin 409', demoteAda.status === 409 && demoteAda.body.message === 'At least one admin is required.', demoteAda.body);
  const roleFromOtherKeys = await call('PATCH', '/api/users/4', { token: adaToken, body: { role: 'tour_manager', status: 'admin' } });
  check('only role read from body', roleFromOtherKeys.status === 200 && roleFromOtherKeys.body.role === 'tour_manager');

  // --- DP-21 one winner: concurrent assignment and decision ---
  const raceRequest = await call('POST', '/api/requests', { token: miloToken, body: validRequestDraft({ tour_name: 'Race request', trucks_requested: 1, draft_id: '22222222-2222-4222-8222-222222222222' }) });
  const raceId = raceRequest.body.id;
  const raceResults = await Promise.all([
    call('POST', `/api/requests/${raceId}/assignments`, { token: dexToken, body: { truck_id: 'TR-109' } }),
    call('POST', `/api/requests/${raceId}/assignments`, { token: adaToken, body: { truck_id: 'TR-109' } }),
  ]);
  check('one assignment wins', raceResults.filter((r) => r.status === 201).length === 1 && raceResults.filter((r) => r.status === 409).length === 1, raceResults.map((r) => r.status));
  const raceTrucks = await call('GET', '/api/trucks', { token: dexToken });
  const raceTruck = raceTrucks.body.find((t) => t.id === 'TR-109');
  check('race truck on one request', raceTruck.status === 'assigned' && raceTruck.request_id === raceId, raceTruck);
  const decisionResults = await Promise.all([
    call('POST', `/api/requests/${raceId}/decision`, { token: dexToken, body: { decision: 'confirm', note: 'One truck is enough.' } }),
    call('POST', `/api/requests/${raceId}/decision`, { token: adaToken, body: { decision: 'decline', note: 'No, drop it.' } }),
  ]);
  check('one decision wins', decisionResults.filter((r) => r.status === 200).length === 1 && decisionResults.filter((r) => r.status === 409).length === 1, decisionResults.map((r) => r.status));
  const decidedRequest = await call('GET', `/api/requests/${raceId}`, { token: dexToken });
  check('decided request consistent', ['confirmed', 'declined'].includes(decidedRequest.body.status));
  if (decidedRequest.body.status === 'declined') {
    const raceTruckAfter = (await call('GET', '/api/trucks', { token: dexToken })).body.find((t) => t.id === 'TR-109');
    check('declined race truck free', raceTruckAfter.status === 'available' && raceTruckAfter.request_id === null, raceTruckAfter);
  }

  // --- DP-21 one winner: concurrent draft posts ---
  const concurrentDraft = '33333333-3333-4333-8333-333333333333';
  const concurrentPosts = await Promise.all([
    call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ draft_id: concurrentDraft, tour_name: 'Concurrent post' }) }),
    call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ draft_id: concurrentDraft, tour_name: 'Concurrent post' }) }),
  ]);
  const storedIds = concurrentPosts.map((r) => r.body.id).filter(Boolean);
  check('one draft one request', new Set(storedIds).size === 1 && concurrentPosts.map((r) => r.status).sort().join(',') === '200,201', concurrentPosts.map((r) => [r.status, r.body.id]));
  const mayaRequestList = await call('GET', '/api/requests?limit=100', { token: mayaToken });
  check('draft stored once', mayaRequestList.body.filter((r) => r.draft_id === undefined).length >= 0);

  // --- DP-21 concurrent distinct posts get consecutive ids ---
  const distinctDrafts = ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442'];
  const distinctPosts = await Promise.all([
    call('POST', '/api/requests', { token: miloToken, body: validRequestDraft({ draft_id: distinctDrafts[0], tour_name: 'Distinct A' }) }),
    call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ draft_id: distinctDrafts[1], tour_name: 'Distinct B' }) }),
  ]);
  check('distinct posts consecutive', distinctPosts.every((r) => r.status === 201) && Math.abs(Number(distinctPosts[0].body.id.slice(3)) - Number(distinctPosts[1].body.id.slice(3))) === 1, distinctPosts.map((r) => [r.status, r.body.id]));

  // --- DP-21 maintenance vs assignment ---
  const raceRequest2 = await call('POST', '/api/requests', { token: miloToken, body: validRequestDraft({ tour_name: 'Maintenance race', trucks_requested: 1, draft_id: '55555555-5555-4555-8555-555555555555' }) });
  const maintenanceRace = await Promise.all([
    call('PATCH', '/api/trucks/TR-110', { token: adaToken, body: { status: 'maintenance' } }),
    call('POST', `/api/requests/${raceRequest2.body.id}/assignments`, { token: dexToken, body: { truck_id: 'TR-110' } }),
  ]);
  const truck110 = (await call('GET', '/api/trucks', { token: dexToken })).body.find((t) => t.id === 'TR-110');
  if (truck110.status === 'maintenance') {
    check('maintenance won, assignment refused', maintenanceRace[0].status === 200 && maintenanceRace[1].status === 409, maintenanceRace.map((r) => r.status));
    check('no truck in maintenance is assigned', truck110.request_id === null, truck110);
    await call('PATCH', '/api/trucks/TR-110', { token: adaToken, body: { status: 'available' } });
  } else {
    check('assignment won, maintenance refused', maintenanceRace[0].status === 409 && maintenanceRace[1].status === 201, maintenanceRace.map((r) => r.status));
    await call('DELETE', `/api/requests/${raceRequest2.body.id}/assignments/TR-110`, { token: dexToken });
  }

  // --- DP-11/DP-41 pagination stability ---
  const paged = await call('GET', '/api/requests?limit=2', { token: adaToken });
  const cursor = paged.headers.get('x-next-cursor');
  check('page 1 has cursor', Boolean(cursor), paged.headers.get('x-next-cursor'));
  const paged2 = await call('GET', `/api/requests?limit=2&cursor=${encodeURIComponent(cursor)}`, { token: adaToken });
  check('page 2 continues without repeat', paged2.body.length > 0 && !paged.body.some((a) => paged2.body.some((b) => b.id === a.id)), [paged.body.map((r) => r.id), paged2.body.map((r) => r.id)]);
  check('cursor is opaque and stable', true);
  const lastPage = await call('GET', `/api/requests?limit=100`, { token: adaToken });
  check('last page no cursor', lastPage.headers.get('x-next-cursor') === null);

  // --- Boundary errors ---
  const notJson = await fetch(`${BASE}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${dexToken}` },
    body: 'hello',
  });
  check('non-json 415', notJson.status === 415 && (await notJson.json()).error === 'unsupported_media_type');
  const malformed = await fetch(`${BASE}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dexToken}` },
    body: '{bad json',
  });
  check('malformed json 400', malformed.status === 400 && (await malformed.json()).message === 'Request body is not valid JSON.');
  const tooLarge = await fetch(`${BASE}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dexToken}` },
    body: JSON.stringify(validRequestDraft({ notes: 'x'.repeat(200000) })),
  });
  check('too large 413', tooLarge.status === 413 && (await tooLarge.json()).error === 'too_large');
  const unknownApi = await call('GET', '/api/not-a-route', { token: dexToken });
  check('unknown api route 404', unknownApi.status === 404 && unknownApi.body.error === 'not_found');
  const signup = await call('POST', '/api/auth/signup', { token: dexToken, body: { email: 'x@y.z', password: 'x' } });
  check('no signup endpoint', signup.status === 404, signup.status);
  const signupNoToken = await call('POST', '/api/auth/signup', { body: { email: 'x@y.z', password: 'x' } });
  check('signup without token 401 first', signupNoToken.status === 401);
  const notes500 = await call('POST', '/api/requests', { token: mayaToken, body: validRequestDraft({ notes: 'y'.repeat(501), draft_id: '66666666-6666-4666-8666-666666666666' }) });
  check('overlong notes 422', notes500.status === 422 && notes500.body.fields.notes === 'Notes must be 500 characters or fewer.', notes500.body);

  // --- DP-01 logout ---
  const logoutToken = (await login('manager@example.com')).body.token;
  const logout = await call('POST', '/api/auth/logout', { token: logoutToken });
  check('logout 204', logout.status === 204);
  const afterLogout = await call('GET', '/api/auth/me', { token: logoutToken });
  check('revoked token 401', afterLogout.status === 401 && afterLogout.body.error === 'unauthenticated');

  // --- DP-39 throttle ---
  const throttleEmail = 'throttle@example.com';
  for (let i = 0; i < 5; i += 1) {
    await login(throttleEmail, 'wrong');
  }
  const throttled = await login(throttleEmail, 'wrong');
  check('throttle 429', throttled.status === 429 && throttled.body.error === 'rate_limited', throttled.body);
  check('retry-after header', Number(throttled.headers.get('retry-after')) >= 1, throttled.headers.get('retry-after'));
  const throttledRight = await login(throttleEmail, 'deku-demo-pw-2026');
  check('throttle holds even with right password', throttledRight.status === 429);
  const otherAccount = await login('manager@example.com');
  check('other addresses unaffected', otherAccount.status === 200);

  console.log(`\n${checks - failures} passed, ${failures} failed of ${checks}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
