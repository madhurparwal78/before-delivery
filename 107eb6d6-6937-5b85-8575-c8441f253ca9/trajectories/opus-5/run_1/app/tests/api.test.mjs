import { api, check, equal, login, PASSWORD, requestPayload, stopsPayload } from './harness.mjs';

const sortFields = (body) => ({
  ...body,
  fields: Object.fromEntries(Object.entries(body.fields).sort(([a], [b]) => a.localeCompare(b)))
});

export async function runApiTests() {
  /* DP-01 / DP-02 sign-in */
  const admin = await login('admin@example.com');
  const dispatcher = await login('dispatcher@example.com');
  const maya = await login('manager@example.com');
  const milo = await login('milo@example.com');
  check('DP-01 tokens issued', Boolean(admin && dispatcher && maya && milo));

  const me = await api('/api/auth/me', { token: maya });
  equal('DP-01 me describes member', me.body, {
    user: { id: 3, name: 'Maya Manager', email: 'manager@example.com', role: 'tour_manager' }
  });

  const caseInsensitive = await api('/api/auth/login', {
    method: 'POST',
    body: { email: '  MANAGER@Example.com ', password: PASSWORD }
  });
  check('DP-01 email trimmed and case-insensitive', caseInsensitive.status === 200);

  const throwaway = await login('milo@example.com');
  const loggedOut = await api('/api/auth/logout', { method: 'POST', token: throwaway });
  check('DP-01 logout 204', loggedOut.status === 204);
  const revoked = await api('/api/auth/me', { token: throwaway });
  equal('DP-02 revoked token 401', [revoked.status, revoked.body], [401, { error: 'unauthenticated' }]);

  const wrongPassword = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'nope' }
  });
  const unknownEmail = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'nope' }
  });
  const missingFields = await api('/api/auth/login', { method: 'POST', body: {} });
  equal('DP-02 wrong password 401 copy', [wrongPassword.status, wrongPassword.body], [
    401,
    { error: 'invalid_credentials', message: 'Invalid email or password.' }
  ]);
  equal('DP-02 unknown email same copy', unknownEmail.body, wrongPassword.body);
  equal('DP-02 missing fields same copy', [missingFields.status, missingFields.body], [401, wrongPassword.body]);

  const noToken = await api('/api/requests');
  equal('DP-02 no token 401', [noToken.status, noToken.body], [401, { error: 'unauthenticated' }]);
  const badToken = await api('/api/requests', { token: 'not-a-token' });
  check('DP-02 unknown token 401', badToken.status === 401);

  /* DP-39 throttle */
  const throttleEmail = `throttle-${Date.now()}@example.com`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api('/api/auth/login', {
      method: 'POST',
      body: { email: throttleEmail, password: 'wrong' }
    });
    check(`DP-39 failure ${attempt + 1} answers 401`, response.status === 401);
  }
  const throttled = await api('/api/auth/login', {
    method: 'POST',
    body: { email: throttleEmail, password: 'wrong' }
  });
  equal('DP-39 sixth attempt 429', [throttled.status, throttled.body], [
    429,
    { error: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' }
  ]);
  const retryAfter = Number(throttled.headers.get('retry-after'));
  check('DP-39 Retry-After within window', retryAfter >= 1 && retryAfter <= 900, String(retryAfter));
  const otherAddress = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: PASSWORD }
  });
  check('DP-39 other address unaffected', otherAddress.status === 200);

  const knownThrottle = `admin@example.com`;
  check('DP-39 known address still signs in', (await login(knownThrottle)) !== undefined);

  /* DP-04 fleet */
  const trucks = await api('/api/trucks', { token: dispatcher });
  equal(
    'DP-04 ten trucks in id order',
    trucks.body.map((truck) => truck.id),
    ['TR-101', 'TR-102', 'TR-103', 'TR-104', 'TR-105', 'TR-106', 'TR-107', 'TR-108', 'TR-109', 'TR-110']
  );
  equal('DP-04 TR-103 assigned to LR-0001', trucks.body[2], {
    id: 'TR-103',
    depot: 'north',
    status: 'assigned',
    request_id: 'LR-0001'
  });
  equal('DP-04 TR-104 maintenance', trucks.body[3].status, 'maintenance');
  const availableTrucks = await api('/api/trucks?status=available', { token: dispatcher });
  equal(
    'DP-04 available filter',
    availableTrucks.body.map((truck) => truck.id),
    ['TR-101', 'TR-102', 'TR-105', 'TR-108', 'TR-109', 'TR-110']
  );
  const badTruckStatus = await api('/api/trucks?status=nope', { token: dispatcher });
  equal('DP-04 bad truck status 400', [badTruckStatus.status, badTruckStatus.body], [
    400,
    { error: 'bad_request', message: 'status must be available, assigned or maintenance.' }
  ]);

  /* DP-05 seeded requests */
  const all = await api('/api/requests', { token: dispatcher });
  equal(
    'DP-05 four seeded requests newest first',
    all.body.map((item) => item.id),
    ['LR-0002', 'LR-0001', 'LR-0003', 'LR-0004']
  );
  const lr3 = await api('/api/requests/LR-0003', { token: dispatcher });
  equal('DP-05 LR-0003 confirmed with two trucks', [
    lr3.body.status,
    lr3.body.trucks_assigned,
    lr3.body.trucks.map((truck) => truck.id),
    lr3.body.decided_by,
    lr3.body.decision_note
  ], ['confirmed', 2, ['TR-106', 'TR-107'], { id: 2, name: 'Dex Dispatcher' }, 'Confirmed with two southern trucks.']);
  equal(
    'DP-05 stops in order',
    lr3.body.stops.map((stop) => [stop.kind, stop.city, stop.date]),
    [
      ['pickup', 'Calgary', '2026-03-01'],
      ['delivery', 'Vancouver', '2026-03-02'],
      ['first_show', 'Vancouver', '2026-03-03'],
      ['last_show', 'Seattle', '2026-03-15']
    ]
  );
  const lr3Activity = await api('/api/requests/LR-0003/activity', { token: dispatcher });
  equal(
    'DP-05 activity oldest first',
    lr3Activity.body.map((entry) => [entry.kind, entry.note]),
    [
      ['submitted', 'Requested 2 trucks'],
      ['truck_assigned', 'TR-106 assigned'],
      ['truck_assigned', 'TR-107 assigned'],
      ['confirmed', 'Confirmed with two southern trucks.']
    ]
  );
  const lr4 = await api('/api/requests/LR-0004', { token: dispatcher });
  equal('DP-05 LR-0004 declined, no trucks', [lr4.body.status, lr4.body.trucks, lr4.body.decision_note], [
    'declined',
    [],
    'No trucks free on those dates.'
  ]);
  equal('DP-05 LR-0004 stops have no dates', lr4.body.stops.map((stop) => stop.date), [null, null, null, null]);

  /* DP-06 board */
  const board = await api('/api/dispatch', { token: dispatcher });
  equal('DP-06 board oldest first', board.body.requests.map((item) => item.id), ['LR-0001', 'LR-0002']);
  equal('DP-06 board summary', board.body.summary, { waiting: 2, trucks_needed: 4, trucks_available: 6 });

  /* DP-07 validation */
  const invalid = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: {
      tour_name: '   ',
      transport_type: 'rocket',
      trucks_requested: 9,
      notes: 'x'.repeat(501),
      stops: stopsPayload({ delivery: { date: '2026-04-09' }, pickup: { city: '' }, last_show: { date: 'nope' } })
    }
  });
  equal('DP-07 validation status', invalid.status, 422);
  equal('DP-07 validation fields', sortFields(invalid.body), {
    error: 'validation',
    fields: {
      notes: 'Notes must be 500 characters or fewer.',
      'stops.delivery.date': 'Delivery cannot be before pickup.',
      'stops.last_show.date': 'Enter a valid date.',
      'stops.pickup.city': 'City is required.',
      tour_name: 'Tour name is required.',
      transport_type: 'Choose a type of transportation.',
      trucks_requested: 'Enter a number of trucks from 1 to 8.'
    }
  });
  const missingStop = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ stops: { pickup: stopsPayload().pickup } })
  });
  equal('DP-07 missing stops keyed by kind', Object.keys(missingStop.body.fields).sort(), [
    'stops.delivery',
    'stops.first_show',
    'stops.last_show'
  ]);
  const badDraft = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ draft_id: 'not-a-uuid' })
  });
  equal('DP-07 bad draft id 422', [badDraft.status, Object.keys(badDraft.body.fields)], [422, ['draft_id']]);
  const lastShowOrder = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ stops: stopsPayload({ last_show: { date: '2026-04-11' } }) })
  });
  equal('DP-07 last show before first show', lastShowOrder.body.fields, {
    'stops.last_show.date': 'Last show cannot be before the first show.'
  });
  const countAfterRefusals = await api('/api/requests', { token: dispatcher });
  equal('DP-07 nothing stored by refusals', countAfterRefusals.body.length, 4);

  /* DP-08 stored submission */
  const created = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({
      notes: 'Two trucks please.',
      id: 'LR-9999',
      status: 'confirmed',
      requester_id: 1,
      trucks_assigned: 7,
      role: 'admin',
      decided_by: 1
    })
  });
  equal('DP-08 created 201 with next id', [created.status, created.body.id], [201, 'LR-0005']);
  equal('DP-08 ignores injected fields', [
    created.body.status,
    created.body.requester,
    created.body.trucks_assigned,
    created.body.decided_by
  ], ['submitted', { id: 3, name: 'Maya Manager' }, 0, null]);
  equal('DP-08 four stops stored', created.body.stops.map((stop) => stop.kind), [
    'pickup',
    'delivery',
    'first_show',
    'last_show'
  ]);
  const createdActivity = await api('/api/requests/LR-0005/activity', { token: maya });
  equal('DP-08 one submitted entry', createdActivity.body.map((entry) => [entry.kind, entry.note, entry.actor.name]), [
    ['submitted', 'Requested 2 trucks', 'Maya Manager']
  ]);
  const single = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ tour_name: 'Single truck run', trucks_requested: 1 })
  });
  const singleActivity = await api(`/api/requests/${single.body.id}/activity`, { token: maya });
  equal('DP-08 singular truck wording', singleActivity.body[0].note, 'Requested 1 truck');

  /* DP-44 draft replay */
  const draftId = '7f1f0f6e-5d0b-4a9b-9a37-3b2f1c0d4e5a';
  const firstDraft = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ tour_name: 'Draft run', draft_id: draftId })
  });
  const replay = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: requestPayload({ tour_name: 'Different name', draft_id: draftId })
  });
  equal('DP-44 replay returns stored request with 200', [replay.status, replay.body.id, replay.body.tour_name], [
    200,
    firstDraft.body.id,
    'Draft run'
  ]);
  const otherMemberDraft = await api('/api/requests', {
    method: 'POST',
    token: milo,
    body: requestPayload({ tour_name: 'Milo draft', draft_id: draftId })
  });
  check('DP-44 same draft id for another member is its own request', otherMemberDraft.status === 201 &&
    otherMemberDraft.body.id !== firstDraft.body.id);

  const simultaneousDraft = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  const [draftA, draftB] = await Promise.all([
    api('/api/requests', { method: 'POST', token: maya, body: requestPayload({ draft_id: simultaneousDraft }) }),
    api('/api/requests', { method: 'POST', token: maya, body: requestPayload({ draft_id: simultaneousDraft }) })
  ]);
  const draftStatuses = [draftA.status, draftB.status].sort();
  equal('DP-44 simultaneous draft posts: one 201 one 200', draftStatuses, [200, 201]);
  equal('DP-44 simultaneous draft posts share an id', draftA.body.id, draftB.body.id);
  const draftActivity = await api(`/api/requests/${draftA.body.id}/activity`, { token: maya });
  equal('DP-44 one submitted entry for the draft', draftActivity.body.length, 1);

  /* DP-04 request ids are consecutive under load */
  const burst = await Promise.all(
    Array.from({ length: 6 }, (unused, index) =>
      api('/api/requests', { method: 'POST', token: maya, body: requestPayload({ tour_name: `Burst ${index}` }) })
    )
  );
  check('DP-04 burst posts all 201', burst.every((response) => response.status === 201));
  const burstIds = burst.map((response) => Number(response.body.id.slice(3))).sort((a, b) => a - b);
  check(
    'DP-04 burst ids consecutive with no gaps',
    burstIds.every((value, index) => index === 0 || value === burstIds[index - 1] + 1),
    JSON.stringify(burstIds)
  );

  /* DP-11 list paging and filters */
  const limited = await api('/api/requests?limit=3', { token: dispatcher });
  equal('DP-11 limit honoured', limited.body.length, 3);
  const cursor = limited.headers.get('x-next-cursor');
  check('DP-11 cursor present while more follow', Boolean(cursor));
  const nextPage = await api(`/api/requests?limit=3&cursor=${encodeURIComponent(cursor)}`, { token: dispatcher });
  const overlap = nextPage.body.filter((item) => limited.body.some((first) => first.id === item.id));
  equal('DP-41 cursor pages do not repeat', overlap.length, 0);
  const badLimit = await api('/api/requests?limit=0', { token: dispatcher });
  equal('DP-11 bad limit 400', [badLimit.status, badLimit.body.message], [
    400,
    'limit must be a whole number from 1 to 100.'
  ]);
  const badLimitHigh = await api('/api/requests?limit=101', { token: dispatcher });
  check('DP-11 limit above 100 refused', badLimitHigh.status === 400);
  const limit100 = await api('/api/requests?limit=100', { token: dispatcher });
  check('DP-11 limit 100 allowed', limit100.status === 200);
  const badStatus = await api('/api/requests?status=pending', { token: dispatcher });
  equal('DP-11 bad status 400', [badStatus.status, badStatus.body.message], [
    400,
    'status must be submitted, confirmed or declined.'
  ]);
  const badCursor = await api('/api/requests?cursor=zzzz', { token: dispatcher });
  equal('DP-11 bad cursor 400', [badCursor.status, badCursor.body.message], [400, 'cursor is not valid.']);
  const confirmedOnly = await api('/api/requests?status=confirmed', { token: dispatcher });
  check('DP-11 status filter', confirmedOnly.body.every((item) => item.status === 'confirmed'));
  const searched = await api('/api/requests?q=velvet%20fuzz', { token: dispatcher });
  equal('DP-11 q matches case-insensitively', searched.body.map((item) => item.id), ['LR-0001']);

  /* DP-13 / DP-45 visibility */
  const mayaList = await api('/api/requests', { token: maya });
  check('DP-13 manager sees only own requests', mayaList.body.every((item) => item.requester.id === 3));
  const hidden = await api('/api/requests/LR-0002', { token: maya });
  equal('DP-13 another manager request 404', [hidden.status, hidden.body], [404, { error: 'not_found' }]);
  const hiddenActivity = await api('/api/requests/LR-0002/activity', { token: maya });
  equal('DP-45 hidden activity 404', [hiddenActivity.status, hiddenActivity.body], [404, { error: 'not_found' }]);
  const missing = await api('/api/requests/LR-9999', { token: maya });
  equal('DP-14 missing request answers like a hidden one', [missing.status, missing.body], [404, hidden.body]);

  /* DP-24 tour managers kept out */
  const boardRefused = await api('/api/dispatch', { token: maya });
  equal('DP-24 board 403', [boardRefused.status, boardRefused.body], [
    403,
    { error: 'forbidden', message: 'You do not have access to this page.' }
  ]);
  const trucksRefused = await api('/api/trucks', { token: maya });
  check('DP-24 trucks 403', trucksRefused.status === 403);
  const assignRefused = await api('/api/requests/LR-0001/assignments', {
    method: 'POST',
    token: maya,
    body: { truck_id: 'TR-101', role: 'admin' }
  });
  check('DP-24 assignment 403', assignRefused.status === 403);
  const decisionRefused = await api('/api/requests/LR-0005/decision', {
    method: 'POST',
    token: maya,
    body: { decision: 'confirm', note: 'mine' }
  });
  check('DP-24 decision 403', decisionRefused.status === 403);
  const usersRefused = await api('/api/users', { token: dispatcher });
  check('DP-27 members list admin only', usersRefused.status === 403);
  const signup = await api('/api/auth/signup', { method: 'POST', token: maya, body: { email: 'x@example.com' } });
  equal('DP-27 no signup endpoint', [signup.status, signup.body], [404, { error: 'not_found' }]);

  /* DP-16 / DP-17 assignment */
  const target = created.body.id;
  const assigned = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-101' }
  });
  equal('DP-16 assignment 201', [assigned.status, assigned.body.trucks_assigned, assigned.body.trucks], [
    201,
    1,
    [{ id: 'TR-101', depot: 'north' }]
  ]);
  const truckAfterAssign = await api('/api/trucks?status=assigned', { token: dispatcher });
  check(
    'DP-16 truck reads assigned to the request',
    truckAfterAssign.body.some((truck) => truck.id === 'TR-101' && truck.request_id === target)
  );
  const assignActivity = await api(`/api/requests/${target}/activity`, { token: dispatcher });
  equal('DP-16 truck_assigned activity', assignActivity.body.at(-1).note, 'TR-101 assigned');

  const busyTruck = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-103' }
  });
  equal('DP-17 busy truck 409', [busyTruck.status, busyTruck.body], [
    409,
    { error: 'conflict', message: 'This truck is not available.' }
  ]);
  const parkedTruck = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-104' }
  });
  equal('DP-17 maintenance truck 409', parkedTruck.body.message, 'This truck is not available.');
  const unknownTruck = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-999' }
  });
  equal('DP-17 unknown truck 422', [unknownTruck.status, unknownTruck.body], [
    422,
    { error: 'validation', fields: { truck_id: 'Choose a truck from the fleet.' } }
  ]);
  await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-102' }
  });
  const beyondCount = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-105' }
  });
  equal('DP-17 beyond requested count 409', [beyondCount.status, beyondCount.body.message], [
    409,
    'This request already has every truck it asked for.'
  ]);

  /* DP-19 confirmation */
  const earlyConfirm = await api(`/api/requests/${single.body.id}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'confirm', note: 'too early' }
  });
  equal('DP-19 confirm short 409', [earlyConfirm.status, earlyConfirm.body.message], [
    409,
    'Assign every requested truck before confirming.'
  ]);
  const confirmed = await api(`/api/requests/${target}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'confirm', note: '  Two trucks confirmed for the spring run.  ' }
  });
  equal('DP-19 confirmed', [confirmed.status, confirmed.body.status, confirmed.body.decision_note], [
    200,
    'confirmed',
    'Two trucks confirmed for the spring run.'
  ]);
  check('DP-19 decider recorded', confirmed.body.decided_by.id === 2 && Boolean(confirmed.body.decided_at));
  const confirmedActivity = await api(`/api/requests/${target}/activity`, { token: dispatcher });
  equal('DP-19 confirmed activity note', confirmedActivity.body.at(-1), {
    id: confirmedActivity.body.at(-1).id,
    kind: 'confirmed',
    actor: { id: 2, name: 'Dex Dispatcher' },
    note: 'Two trucks confirmed for the spring run.',
    created_at: confirmedActivity.body.at(-1).created_at
  });
  const confirmedTrucksStay = await api('/api/trucks?status=assigned', { token: dispatcher });
  check(
    'DP-19 confirmed request keeps its trucks',
    confirmedTrucksStay.body.filter((truck) => truck.request_id === target).length === 2
  );

  /* DP-20 decided once */
  const assignAfterDecision = await api(`/api/requests/${target}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-105' }
  });
  equal('DP-20 assignment on decided request 409', [assignAfterDecision.status, assignAfterDecision.body.message], [
    409,
    'This request has already been decided.'
  ]);
  const releaseAfterDecision = await api(`/api/requests/${target}/assignments/TR-101`, {
    method: 'DELETE',
    token: dispatcher
  });
  equal('DP-20 release on decided request 409', [releaseAfterDecision.status, releaseAfterDecision.body.message], [
    409,
    'This request has already been decided.'
  ]);
  const releaseStrangerAfterDecision = await api(`/api/requests/${target}/assignments/TR-109`, {
    method: 'DELETE',
    token: dispatcher
  });
  equal('DP-18 decided conflict precedes not-on-request', releaseStrangerAfterDecision.status, 409);
  const decideTwice = await api(`/api/requests/${target}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'decline', note: 'again' }
  });
  equal('DP-20 second decision 409', decideTwice.body.message, 'This request has already been decided.');
  const badDecision = await api(`/api/requests/${single.body.id}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'maybe', note: 'hm' }
  });
  equal('DP-20 bad decision 422', [badDecision.status, Object.keys(badDecision.body.fields)], [422, ['decision']]);
  const missingNote = await api(`/api/requests/${single.body.id}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'decline' }
  });
  equal('DP-20 missing note 422', missingNote.body.fields, { note: 'Add a note to explain your decision.' });

  /* DP-18 release */
  const releaseTarget = burst[0].body.id;
  await api(`/api/requests/${releaseTarget}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-105' }
  });
  const released = await api(`/api/requests/${releaseTarget}/assignments/TR-105`, {
    method: 'DELETE',
    token: dispatcher
  });
  equal('DP-18 release 204', released.status, 204);
  const afterRelease = await api('/api/trucks?status=available', { token: dispatcher });
  check('DP-18 truck free again', afterRelease.body.some((truck) => truck.id === 'TR-105'));
  const releaseActivity = await api(`/api/requests/${releaseTarget}/activity`, { token: dispatcher });
  equal('DP-18 truck_released activity', releaseActivity.body.at(-1).note, 'TR-105 released');
  const releaseNotOn = await api(`/api/requests/${releaseTarget}/assignments/TR-109`, {
    method: 'DELETE',
    token: dispatcher
  });
  equal('DP-18 truck not on submitted request 404', [releaseNotOn.status, releaseNotOn.body], [
    404,
    { error: 'not_found' }
  ]);
  const releaseUnknownTruck = await api(`/api/requests/${releaseTarget}/assignments/TR-777`, {
    method: 'DELETE',
    token: dispatcher
  });
  equal('DP-18 unknown truck in path 404', releaseUnknownTruck.status, 404);

  /* DP-20 / DP-43 decline */
  const declineTarget = burst[1].body.id;
  await api(`/api/requests/${declineTarget}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-108' }
  });
  await api(`/api/requests/${declineTarget}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-109' }
  });
  const declined = await api(`/api/requests/${declineTarget}/decision`, {
    method: 'POST',
    token: dispatcher,
    body: { decision: 'decline', note: 'No trucks for those dates.' }
  });
  equal('DP-20 declined releases every truck', [declined.body.status, declined.body.trucks, declined.body.trucks_assigned], [
    'declined',
    [],
    0
  ]);
  const declinedActivity = await api(`/api/requests/${declineTarget}/activity`, { token: dispatcher });
  equal(
    'DP-20 releases recorded before the decline',
    declinedActivity.body.map((entry) => entry.kind),
    ['submitted', 'truck_assigned', 'truck_assigned', 'truck_released', 'truck_released', 'declined']
  );
  const freedTrucks = await api('/api/trucks?status=available', { token: dispatcher });
  check(
    'DP-43 declined trucks free at once',
    ['TR-108', 'TR-109'].every((id) => freedTrucks.body.some((truck) => truck.id === id))
  );
  const reassign = await api(`/api/requests/${burst[2].body.id}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: 'TR-108' }
  });
  equal('DP-43 freed truck goes on another request at once', reassign.status, 201);

  /* DP-21 one winner: two assignments of one truck */
  const raceA = burst[3].body.id;
  const raceB = burst[4].body.id;
  const [winner, loser] = await Promise.all([
    api(`/api/requests/${raceA}/assignments`, { method: 'POST', token: dispatcher, body: { truck_id: 'TR-110' } }),
    api(`/api/requests/${raceB}/assignments`, { method: 'POST', token: admin, body: { truck_id: 'TR-110' } })
  ]);
  const assignStatuses = [winner.status, loser.status].sort();
  equal('DP-21 one assignment wins', assignStatuses, [201, 409]);
  const conflictBody = [winner, loser].find((response) => response.status === 409).body;
  equal('DP-21 loser gets the not-available copy', conflictBody.message, 'This truck is not available.');
  const tr110 = await api('/api/trucks?status=assigned', { token: dispatcher });
  equal(
    'DP-40 TR-110 ends on exactly one request',
    tr110.body.filter((truck) => truck.id === 'TR-110').length,
    1
  );

  /* DP-21 two decisions on one request */
  const decisionRace = burst[5].body.id;
  const decisionRaceRequest = await api(`/api/requests/${decisionRace}`, { token: dispatcher });
  for (const truck of ['TR-101'].slice(0, decisionRaceRequest.body.trucks_requested)) {
    await api(`/api/requests/${decisionRace}/assignments`, {
      method: 'POST',
      token: dispatcher,
      body: { truck_id: truck }
    });
  }
  const [decideA, decideB] = await Promise.all([
    api(`/api/requests/${decisionRace}/decision`, {
      method: 'POST',
      token: dispatcher,
      body: { decision: 'decline', note: 'first' }
    }),
    api(`/api/requests/${decisionRace}/decision`, {
      method: 'POST',
      token: admin,
      body: { decision: 'decline', note: 'second' }
    })
  ]);
  equal('DP-21 one decision wins', [decideA.status, decideB.status].sort(), [200, 409]);

  /* DP-43 decline racing an assignment */
  const declineRace = (
    await api('/api/requests', {
      method: 'POST',
      token: maya,
      body: requestPayload({ tour_name: 'Decline race', trucks_requested: 3 })
    })
  ).body.id;
  const raceTruck = (await api('/api/trucks?status=available', { token: dispatcher })).body[0].id;
  const [declineResult, assignResult] = await Promise.all([
    api(`/api/requests/${declineRace}/decision`, {
      method: 'POST',
      token: dispatcher,
      body: { decision: 'decline', note: 'standing down' }
    }),
    api(`/api/requests/${declineRace}/assignments`, {
      method: 'POST',
      token: admin,
      body: { truck_id: raceTruck }
    })
  ]);
  equal('DP-43 the decline always lands', declineResult.status, 200);
  check('DP-43 the assignment either lands first or is refused', [201, 409].includes(assignResult.status),
    String(assignResult.status));
  const declineRaceRequest = await api(`/api/requests/${declineRace}`, { token: dispatcher });
  equal('DP-43 declined request holds no trucks after the race', [
    declineRaceRequest.body.status,
    declineRaceRequest.body.trucks
  ], ['declined', []]);
  const racedTruck = (await api('/api/trucks', { token: dispatcher })).body.find((truck) => truck.id === raceTruck);
  equal('DP-43 the raced truck is free', [racedTruck.status, racedTruck.request_id], ['available', null]);

  /* DP-21 a release racing a confirm on a fully assigned request */
  const confirmRace = (
    await api('/api/requests', {
      method: 'POST',
      token: maya,
      body: requestPayload({ tour_name: 'Confirm race', trucks_requested: 1 })
    })
  ).body.id;
  const confirmRaceTruck = (await api('/api/trucks?status=available', { token: dispatcher })).body[0].id;
  await api(`/api/requests/${confirmRace}/assignments`, {
    method: 'POST',
    token: dispatcher,
    body: { truck_id: confirmRaceTruck }
  });
  const [releaseResult, confirmResult] = await Promise.all([
    api(`/api/requests/${confirmRace}/assignments/${confirmRaceTruck}`, { method: 'DELETE', token: dispatcher }),
    api(`/api/requests/${confirmRace}/decision`, {
      method: 'POST',
      token: admin,
      body: { decision: 'confirm', note: 'racing the release' }
    })
  ]);
  check(
    'DP-21 release and confirm resolve one way or the other',
    (releaseResult.status === 204 && confirmResult.status === 409 &&
      confirmResult.body.message === 'Assign every requested truck before confirming.') ||
      (confirmResult.status === 200 && releaseResult.status === 409 &&
        releaseResult.body.message === 'This request has already been decided.'),
    `${releaseResult.status}/${confirmResult.status}`
  );
  const confirmRaceRequest = await api(`/api/requests/${confirmRace}`, { token: dispatcher });
  check(
    'DP-21 a request is never confirmed short',
    confirmRaceRequest.body.status !== 'confirmed' ||
      confirmRaceRequest.body.trucks_assigned === confirmRaceRequest.body.trucks_requested,
    JSON.stringify([confirmRaceRequest.body.status, confirmRaceRequest.body.trucks_assigned])
  );

  /* DP-21 a decline racing the release of one of its trucks */
  const releaseRace = (
    await api('/api/requests', {
      method: 'POST',
      token: maya,
      body: requestPayload({ tour_name: 'Release race', trucks_requested: 2 })
    })
  ).body.id;
  const releaseRaceTrucks = (await api('/api/trucks?status=available', { token: dispatcher })).body
    .slice(0, 2)
    .map((truck) => truck.id);
  for (const truckId of releaseRaceTrucks) {
    await api(`/api/requests/${releaseRace}/assignments`, {
      method: 'POST',
      token: dispatcher,
      body: { truck_id: truckId }
    });
  }
  const [raceRelease, raceDecline] = await Promise.all([
    api(`/api/requests/${releaseRace}/assignments/${releaseRaceTrucks[0]}`, { method: 'DELETE', token: dispatcher }),
    api(`/api/requests/${releaseRace}/decision`, {
      method: 'POST',
      token: admin,
      body: { decision: 'decline', note: 'standing the run down' }
    })
  ]);
  check(
    'DP-21 release and decline resolve one way or the other',
    (raceRelease.status === 204 && raceDecline.status === 200) ||
      (raceDecline.status === 200 && raceRelease.status === 409),
    `${raceRelease.status}/${raceDecline.status}`
  );
  const racedTrucks = (await api('/api/trucks', { token: dispatcher })).body.filter((truck) =>
    releaseRaceTrucks.includes(truck.id)
  );
  check(
    'DP-43 both raced trucks end free',
    racedTrucks.every((truck) => truck.status === 'available' && truck.request_id === null),
    JSON.stringify(racedTrucks)
  );
  const releaseRaceActivity = await api(`/api/requests/${releaseRace}/activity`, { token: dispatcher });
  equal(
    'DP-21 one release entry per truck',
    releaseRaceActivity.body.filter(
      (entry) => entry.kind === 'truck_released' && entry.note === `${releaseRaceTrucks[0]} released`
    ).length,
    1
  );

  /* DP-46 ending maintenance while an assignment arrives */
  const endMaintenanceRace = (
    await api('/api/requests', {
      method: 'POST',
      token: maya,
      body: requestPayload({ tour_name: 'End maintenance race', trucks_requested: 1 })
    })
  ).body.id;
  await api('/api/trucks/TR-104', { method: 'PATCH', token: admin, body: { status: 'maintenance' } });
  const [ended, assignedWhileEnding] = await Promise.all([
    api('/api/trucks/TR-104', { method: 'PATCH', token: admin, body: { status: 'available' } }),
    api(`/api/requests/${endMaintenanceRace}/assignments`, {
      method: 'POST',
      token: dispatcher,
      body: { truck_id: 'TR-104' }
    })
  ]);
  check('DP-46 ending maintenance always lands', ended.status === 200, String(ended.status));
  check(
    'DP-46 a truck in maintenance is never assigned',
    assignedWhileEnding.status === 201 ||
      (assignedWhileEnding.status === 409 && assignedWhileEnding.body.message === 'This truck is not available.'),
    `${assignedWhileEnding.status}`
  );

  /* DP-46 maintenance against assignment */
  const maintenanceRace = (
    await api('/api/requests', {
      method: 'POST',
      token: maya,
      body: requestPayload({ tour_name: 'Maintenance race', trucks_requested: 1 })
    })
  ).body.id;
  const [maintenanceResult, assignDuringMaintenance] = await Promise.all([
    api('/api/trucks/TR-105', { method: 'PATCH', token: admin, body: { status: 'maintenance' } }),
    api(`/api/requests/${maintenanceRace}/assignments`, {
      method: 'POST',
      token: dispatcher,
      body: { truck_id: 'TR-105' }
    })
  ]);
  check(
    'DP-46 one winner between maintenance and assignment',
    (maintenanceResult.status === 200 && assignDuringMaintenance.status === 409) ||
      (maintenanceResult.status === 409 && assignDuringMaintenance.status === 201),
    `${maintenanceResult.status}/${assignDuringMaintenance.status}`
  );
  const tr105 = (await api('/api/trucks', { token: dispatcher })).body.find((truck) => truck.id === 'TR-105');
  check(
    'DP-46 fleet row stays consistent',
    (tr105.status === 'maintenance' && tr105.request_id === null) ||
      (tr105.status === 'assigned' && tr105.request_id === maintenanceRace),
    JSON.stringify(tr105)
  );

  /* DP-25 maintenance rules */
  const onRequest = await api('/api/trucks/TR-103', { method: 'PATCH', token: admin, body: { status: 'maintenance' } });
  equal('DP-25 truck on a request 409', [onRequest.status, onRequest.body.message], [409, 'This truck is on a request.']);
  const freeTruck = (await api('/api/trucks?status=available', { token: dispatcher })).body[0].id;
  const parked = await api(`/api/trucks/${freeTruck}`, { method: 'PATCH', token: admin, body: { status: 'maintenance' } });
  equal('DP-25 available truck parked', [parked.status, parked.body.status], [200, 'maintenance']);
  const parkedAgain = await api(`/api/trucks/${freeTruck}`, { method: 'PATCH', token: admin, body: { status: 'maintenance' } });
  equal('DP-25 setting the same status answers 200', [parkedAgain.status, parkedAgain.body.status], [200, 'maintenance']);
  const unparked = await api(`/api/trucks/${freeTruck}`, { method: 'PATCH', token: admin, body: { status: 'available' } });
  equal('DP-25 truck returns to the fleet', unparked.body.status, 'available');
  const dispatcherMaintenance = await api(`/api/trucks/${freeTruck}`, {
    method: 'PATCH',
    token: dispatcher,
    body: { status: 'maintenance' }
  });
  check('DP-25 dispatchers cannot park trucks', dispatcherMaintenance.status === 403);
  const unknownTruckPatch = await api('/api/trucks/TR-404', {
    method: 'PATCH',
    token: admin,
    body: { status: 'bogus' }
  });
  equal('DP-25 unknown truck id answers 404 before validation', unknownTruckPatch.status, 404);
  const badStatusPatch = await api(`/api/trucks/${freeTruck}`, { method: 'PATCH', token: admin, body: { status: 'assigned' } });
  equal('DP-25 assigned is not a settable status', [badStatusPatch.status, Object.keys(badStatusPatch.body.fields)], [
    422,
    ['status']
  ]);

  /* DP-27 / DP-28 members and roles */
  const members = await api('/api/users', { token: admin });
  equal('DP-27 four members listed', members.body.length, 4);
  const promoted = await api('/api/users/4', {
    method: 'PATCH',
    token: admin,
    body: { role: 'dispatcher', name: 'Hacker', email: 'hack@example.com' }
  });
  equal('DP-28 role stored, only role read', promoted.body, {
    id: 4,
    name: 'Milo Manager',
    email: 'milo@example.com',
    role: 'dispatcher'
  });
  const miloToken = await login('milo@example.com');
  const miloBoard = await api('/api/dispatch', { token: miloToken });
  check('DP-47 role change applies at once', miloBoard.status === 200);
  const demoted = await api('/api/users/4', { method: 'PATCH', token: admin, body: { role: 'tour_manager' } });
  equal('DP-47 demotion stored', demoted.body.role, 'tour_manager');
  const miloBoardAfter = await api('/api/dispatch', { token: miloToken });
  check('DP-47 old token is refused after demotion', miloBoardAfter.status === 403);
  const badRole = await api('/api/users/4', { method: 'PATCH', token: admin, body: { role: 'owner' } });
  equal('DP-28 unknown role 422', [badRole.status, Object.keys(badRole.body.fields)], [422, ['role']]);
  const lastAdmin = await api('/api/users/1', { method: 'PATCH', token: admin, body: { role: 'dispatcher' } });
  equal('DP-28 demoting the only admin 409', [lastAdmin.status, lastAdmin.body.message], [
    409,
    'At least one admin is required.'
  ]);
  const unknownMember = await api('/api/users/999', { method: 'PATCH', token: admin, body: { role: 'admin' } });
  equal('DP-28 unknown member 404', unknownMember.status, 404);

  /* DP-47 two admins demoting each other */
  await api('/api/users/2', { method: 'PATCH', token: admin, body: { role: 'admin' } });
  const secondAdmin = await login('dispatcher@example.com');
  const [demoteA, demoteB] = await Promise.all([
    api('/api/users/2', { method: 'PATCH', token: admin, body: { role: 'dispatcher' } }),
    api('/api/users/1', { method: 'PATCH', token: secondAdmin, body: { role: 'dispatcher' } })
  ]);
  equal('DP-47 one demotion wins', [demoteA.status, demoteB.status].sort(), [200, 409]);
  const viaAda = (await api('/api/users', { token: await login('admin@example.com') })).body;
  const remaining = Array.isArray(viaAda)
    ? viaAda
    : (await api('/api/users', { token: await login('dispatcher@example.com') })).body;
  equal('DP-47 exactly one admin remains', remaining.filter((member) => member.role === 'admin').length, 1);

  /* server boundary */
  const wrongType = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: 'tour_name=x',
    raw: true,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  equal('boundary 415 for non-JSON body', [wrongType.status, wrongType.body], [
    415,
    { error: 'unsupported_media_type', message: 'Send the body as application/json.' }
  ]);
  const malformed = await api('/api/requests', { method: 'POST', token: maya, body: '{nope', raw: true });
  equal('boundary 400 for malformed JSON', [malformed.status, malformed.body], [
    400,
    { error: 'bad_request', message: 'Request body is not valid JSON.' }
  ]);
  const huge = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: JSON.stringify({ tour_name: 'x'.repeat(100001) }),
    raw: true
  });
  equal('boundary 413 for a large body', [huge.status, huge.body], [
    413,
    { error: 'too_large', message: 'Request body is too large.' }
  ]);
  const atLimit = await api('/api/requests', {
    method: 'POST',
    token: maya,
    body: JSON.stringify({ tour_name: 'Edge', notes: 'n'.repeat(99000) }),
    raw: true
  });
  check('boundary 100,000 bytes allowed', atLimit.status === 422, String(atLimit.status));
  const unknownApi = await api('/api/nowhere', { token: maya });
  equal('unknown api path 404', [unknownApi.status, unknownApi.body], [404, { error: 'not_found' }]);
  const noCors = await api('/api/health');
  check('no cross-origin headers', !noCors.headers.has('access-control-allow-origin'));
}
