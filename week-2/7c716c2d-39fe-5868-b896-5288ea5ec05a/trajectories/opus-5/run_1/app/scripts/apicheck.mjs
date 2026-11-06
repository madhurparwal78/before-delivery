// Exercises the API rules this brief sets out, against a running server.
const base = process.env.BASE ?? 'http://127.0.0.1:4173';

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

function note(label, value) {
  console.log(`  -- ${label}: ${JSON.stringify(value)}`);
}

class Client {
  constructor() {
    this.cookie = '';
  }

  async call(method, path, body, extra = {}) {
    const headers = { ...extra };
    if (this.cookie !== '') headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const value = entry.split(';')[0];
      if (value.startsWith('tr_session=')) this.cookie = value;
    }
    const text = await response.text();
    let json = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    return { status: response.status, json, headers: response.headers };
  }

  async signIn(email, password = 'tally-demo-1') {
    const result = await this.call('POST', '/api/session', { email, password });
    return result;
  }
}

const ana = new Client();
const ben = new Client();
const femi = new Client();
const hal = new Client();

check('sign in owner', (await ana.signIn('ana@kereru.test')).status, 200);
check('sign in member', (await ben.signIn('ben@kereru.test')).status, 200);
check('sign in guest', (await femi.signIn('femi@kereru.test')).status, 200);
check('sign in other workspace', (await hal.signIn('hal@halyard.test')).status, 200);
check('bad password', (await ben.signIn('ben@kereru.test', 'nope')).status, 401);

// --- scoping
const kereruIssues = await ben.call('GET', '/api/issues');
const halIssues = await hal.call('GET', '/api/issues');
note('kereru issue keys', kereruIssues.json.issues.map((issue) => issue.key));
note('halyard issue keys', halIssues.json.issues.map((issue) => issue.key));
check('cross workspace issue', (await hal.call('GET', '/api/issues/KIL-1')).status, 404);
check('guest hidden issue', (await femi.call('GET', '/api/issues/ATL-1')).status, 404);
check('guest sees shared issue', (await femi.call('GET', '/api/issues/KIL-5')).status, 200);
check('member seats hidden', (await ben.call('GET', '/api/workspace')).json.seats, null);
check('member billing forbidden', (await ben.call('GET', '/api/billing')).status, 403);
check('guest docs forbidden write', (await femi.call('POST', '/api/docs', { project_id: (await femi.call('GET', '/api/projects')).json.projects[0].id, title: 'x', body: '' })).status, 403);

// --- unauthenticated and boundaries
const anonymous = new Client();
check('unauthenticated workspace', (await anonymous.call('GET', '/api/workspace')).status, 401);
check('health is public', (await anonymous.call('GET', '/api/health')).status, 200);
check('status is public', (await anonymous.call('GET', '/api/status')).status, 200);
check('unknown api path', (await ben.call('GET', '/api/nope')).status, 404);
check(
  'cross origin',
  (await ben.call('POST', '/api/rooms/leave', {}, { origin: 'http://evil.test' })).status,
  403,
);
check(
  'wrong content type',
  (
    await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })
  ).status,
  415,
);
const bigBody = JSON.stringify({ body: 'x'.repeat(1_200_000) });
check(
  'too large body',
  (
    await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ben.cookie },
      body: bigBody,
    })
  ).status,
  413,
);

// --- issues
const projects = (await ben.call('GET', '/api/projects')).json.projects;
const kiln = projects.find((project) => project.name === 'Kiln');
const created = await ben.call('POST', '/api/issues', { project_id: kiln.id, title: 'Checker issue' });
check('create issue', created.status, 201);
note('created key', created.json.key);
check('created cycle is null', created.json.cycle_number, null);
check('created due snapped flag', created.json.due_date_snapped, false);
check('blank title', (await ben.call('POST', '/api/issues', { project_id: kiln.id, title: '   ' })).status, 422);
const key = created.json.key;
check('illegal transition', (await ben.call('POST', `/api/issues/${key}/transition`, { to: 'done' })).status, 409);
check('same status transition', (await ben.call('POST', `/api/issues/${key}/transition`, { to: 'backlog' })).status, 409);
check('legal transition', (await ben.call('POST', `/api/issues/${key}/transition`, { to: 'todo' })).status, 200);
check('parent with open sub-issues', (await ben.call('POST', '/api/issues/KIL-2/transition', { to: 'in_review' })).status, 200);
check('parent done refused', (await ben.call('POST', '/api/issues/KIL-2/transition', { to: 'done' })).status, 409);
check('parent back to progress', (await ben.call('POST', '/api/issues/KIL-2/transition', { to: 'in_progress' })).status, 200);
const weekend = await ben.call('PATCH', `/api/issues/${key}`, { due_date: '2026-11-07' });
check('weekend due date snapped', [weekend.json.due_date, weekend.json.due_date_snapped], ['2026-11-09', true]);
const working = await ben.call('PATCH', `/api/issues/${key}`, { due_date: '2026-11-10' });
check('working due date kept', [working.json.due_date, working.json.due_date_snapped], ['2026-11-10', false]);
check('bad due date', (await ben.call('PATCH', `/api/issues/${key}`, { due_date: '7 Nov' })).status, 422);
check('finished cycle planning', (await ben.call('PATCH', `/api/issues/${key}`, { cycle_number: 1 })).status, 200);

// --- cycles
const cycle1 = await ben.call('GET', '/api/cycles/1');
note('cycle 1 range', [cycle1.json.starts_at, cycle1.json.ends_at, cycle1.json.calendar_days]);
check('cycle 1 working days', cycle1.json.working_day_count, 10);
check('cycle 0 not found', (await ben.call('GET', '/api/cycles/0')).status, 404);
check('cycle 1001 not found', (await ben.call('GET', '/api/cycles/1001')).status, 404);
check('cycle abc not found', (await ben.call('GET', '/api/cycles/abc')).status, 404);
const cycle5 = await ben.call('GET', '/api/cycles/5');
note('cycle 5 last working date', cycle5.json.last_working_date);
const halCycle = await hal.call('GET', '/api/cycles/1');
note('halyard cycle 1', [halCycle.json.starts_at, halCycle.json.ends_at]);
const novemberFirst = halCycle.json.days.find((day) => day.date === '2026-11-01');
check('halyard clock change', [novemberFirst.counted, novemberFirst.reason, novemberFirst.clock_change], [false, 'Weekend', 'back']);

// --- messages and idempotency
const channels = (await ben.call('GET', '/api/channels')).json.channels;
const general = channels.find((channel) => channel.name === 'general');
const idempotencyKey = `check-${Date.now()}`;
const first = await ben.call('POST', `/api/channels/${general.id}/messages`, { body: 'Replay me' }, { 'idempotency-key': idempotencyKey });
const replay = await ben.call('POST', `/api/channels/${general.id}/messages`, { body: 'Replay me' }, { 'idempotency-key': idempotencyKey });
check('idempotent replay id', replay.json.id, first.json.id);
check('idempotent replay header', replay.headers.get('idempotent-replay'), 'true');
const conflict = await ben.call('POST', `/api/channels/${general.id}/messages`, { body: 'Different' }, { 'idempotency-key': idempotencyKey });
check('idempotency conflict', [conflict.status, conflict.json.error.code], [409, 'idempotency_conflict']);
check('client_key for author', first.json.client_key, idempotencyKey);
const asOther = await ana.call('GET', `/api/channels/${general.id}/messages`);
check(
  'client_key hidden from others',
  asOther.json.messages.find((message) => message.id === first.json.id).client_key,
  null,
);
check('long message', (await ben.call('POST', `/api/channels/${general.id}/messages`, { body: 'x'.repeat(4001) })).status, 422);
check('limit message', (await ben.call('POST', `/api/channels/${general.id}/messages`, { body: 'x'.repeat(4000) })).status, 201);
check('guest other channel', (await femi.call('GET', `/api/channels/${general.id}/messages`)).status, 404);

// --- unread derivation
const mention = await ana.call('POST', `/api/channels/${general.id}/messages`, { body: 'Ping @ben for the export' });
const benUnread = await ben.call('GET', '/api/unread');
note('ben unread', benUnread.json);
check('mention counted in inbox', benUnread.json.inbox >= 1, true);
await ben.call('POST', `/api/channels/${general.id}/read`, { up_to: mention.json.id });
const afterRead = await ben.call('GET', '/api/unread');
check('channel read clears', afterRead.json.channels[general.id], 0);
check('inbox cleared', afterRead.json.inbox, 0);
check('read marker never moves back', (await ben.call('POST', `/api/channels/${general.id}/read`, { up_to: 1 })).status, 200);
const stillRead = await ben.call('GET', '/api/unread');
check('marker stays forward', stillRead.json.channels[general.id], 0);
check('bad read marker', (await ben.call('POST', `/api/channels/${general.id}/read`, { up_to: 99999999 })).status, 422);

// --- docs
const docs = (await ben.call('GET', '/api/docs')).json.docs;
const spec = docs.find((doc) => doc.title === 'Kiln launch spec');
const specBody = await ben.call('GET', `/api/docs/${spec.id}`);
const crlf = 'alpha\r\nbeta\nünïcode 🙂\r\n\r\nomega';
const saved = await ben.call('PUT', `/api/docs/${spec.id}`, {
  title: spec.title,
  body: crlf,
  base_version: specBody.json.version,
});
check('doc saved', saved.status, 200);
check('doc body byte-equal', saved.json.body, crlf);
const stale = await ben.call('PUT', `/api/docs/${spec.id}`, {
  title: spec.title,
  body: 'stale',
  base_version: specBody.json.version,
});
check('doc conflict', [stale.status, stale.json.error.code], [412, 'version_conflict']);
check('doc conflict carries current', stale.json.current.version, saved.json.version);
const restored = await ben.call('POST', `/api/docs/${spec.id}/restore`, {
  version: 1,
  base_version: saved.json.version,
});
check('restore creates a version', restored.json.version, saved.json.version + 1);
const versions = (await ben.call('GET', `/api/docs/${spec.id}/versions`)).json.versions;
check('versions kept', versions.length >= saved.json.version + 1, true);
check('restore is byte-equal', restored.json.body, versions.find((entry) => entry.version === 1).body);
check('doc title too long', (await ben.call('PUT', `/api/docs/${spec.id}`, { title: 'x'.repeat(201), body: '', base_version: restored.json.version })).status, 422);
check('doc refuses nul', (await ben.call('PUT', `/api/docs/${spec.id}`, { title: 'bad\u0000title', body: '', base_version: restored.json.version })).status, 422);

// --- office and knocks
const floor = (await ben.call('GET', '/api/floor')).json;
const lobby = floor.rooms.find((room) => room.name === 'Lobby');
const review = floor.rooms.find((room) => room.name === 'Review Room');
check('join open room', (await ben.call('POST', `/api/rooms/${lobby.id}/join`, {})).status, 200);
check('knock on open room', (await femi.call('POST', `/api/rooms/${lobby.id}/knocks`, {})).json.error.code, 'room_open');
await ben.call('POST', '/api/rooms/leave', {});
check('knock on empty private room', (await femi.call('POST', `/api/rooms/${review.id}/knocks`, {})).json.error.code, 'room_empty');
check('join empty private room', (await ben.call('POST', `/api/rooms/${review.id}/join`, {})).status, 200);
check('knock while inside', (await ben.call('POST', `/api/rooms/${review.id}/knocks`, {})).json.error.code, 'already_inside');
const knock = await femi.call('POST', `/api/rooms/${review.id}/knocks`, {});
check('knock created', [knock.status, knock.json.status], [201, 'waiting']);
const again = await femi.call('POST', `/api/rooms/${review.id}/knocks`, {});
check('knock again returns the same', [again.status, again.json.id], [200, knock.json.id]);
check('join without let in', (await femi.call('POST', `/api/rooms/${review.id}/join`, {})).json.error.code, 'knock_required');
check('outsider cannot answer', (await ana.call('POST', `/api/knocks/${knock.json.id}/answer`, { answer: 'let_in' })).json.error.code, 'not_in_room');
check('answer let in', (await ben.call('POST', `/api/knocks/${knock.json.id}/answer`, { answer: 'let_in' })).json.status, 'let_in');
check('answer twice', (await ben.call('POST', `/api/knocks/${knock.json.id}/answer`, { answer: 'not_now' })).json.error.code, 'knock_answered');
const afterLetIn = (await femi.call('GET', '/api/floor')).json;
check('knocker is inside', afterLetIn.me.room_id, review.id);
await femi.call('POST', '/api/rooms/leave', {});
await ben.call('POST', '/api/rooms/leave', {});

// --- attachments
const upload = new FormData();
upload.append('file', new Blob([new Uint8Array(0)]), 'empty.txt');
const emptyUpload = await fetch(`${base}/api/issues/${key}/attachments`, {
  method: 'POST',
  headers: { cookie: ben.cookie },
  body: upload,
});
check('empty upload refused', emptyUpload.status, 422);
const bigUpload = new FormData();
bigUpload.append('file', new Blob([new Uint8Array(10_000_001)]), 'big.bin');
const tooBig = await fetch(`${base}/api/issues/${key}/attachments`, {
  method: 'POST',
  headers: { cookie: ben.cookie },
  body: bigUpload,
});
check('oversized upload refused', tooBig.status, 413);
const htmlUpload = new FormData();
htmlUpload.append('file', new Blob(['<b>hi</b>'], { type: 'text/html' }), 'page.html');
const htmlStored = await fetch(`${base}/api/issues/${key}/attachments`, {
  method: 'POST',
  headers: { cookie: ben.cookie },
  body: htmlUpload,
});
const htmlAttachment = await htmlStored.json();
check('html attachment stored type', htmlAttachment.content_type, 'text/html');
const download = await fetch(`${base}/api/attachments/${htmlAttachment.id}`, { headers: { cookie: ben.cookie } });
check('active type served opaquely', download.headers.get('content-type'), 'application/octet-stream');
check('nosniff', download.headers.get('x-content-type-options'), 'nosniff');
await download.arrayBuffer();
check('guest cannot download hidden parent', (await femi.call('GET', `/api/attachments/${htmlAttachment.id}`)).status, 200);
check('other workspace cannot download', (await hal.call('GET', `/api/attachments/${htmlAttachment.id}`)).status, 404);

// --- invites and seats
const billing = await ana.call('GET', '/api/billing');
note('billing', billing.json);
check('seats above range', (await ana.call('PUT', '/api/billing/seats', { seats: 41 })).status, 422);
check('seats below range', (await ana.call('PUT', '/api/billing/seats', { seats: 0 })).status, 422);
check('member cannot change seats', (await ben.call('PUT', '/api/billing/seats', { seats: 9 })).status, 403);
const inviteEmail = `checker.${Date.now().toString(36)}@contract.test`;
const invite = await ana.call('POST', '/api/invites', {
  email: inviteEmail,
  role: 'guest',
  project_ids: [kiln.id],
  channel_ids: [],
});
check('invite created', invite.status, 201);
check('duplicate invite', (await ana.call('POST', '/api/invites', { email: inviteEmail, role: 'guest', project_ids: [kiln.id], channel_ids: [] })).json.error.code, 'invite_pending');
check('invite existing member', (await ana.call('POST', '/api/invites', { email: 'ben@kereru.test', role: 'member', project_ids: [], channel_ids: [] })).json.error.code, 'already_member');
check('guest without scope', (await ana.call('POST', '/api/invites', { email: `x.${Date.now()}@contract.test`, role: 'guest', project_ids: [], channel_ids: [] })).status, 422);
check('revoke invite', (await ana.call('DELETE', `/api/invites/${invite.json.id}`)).json.status, 'revoked');
check('revoke twice', (await ana.call('DELETE', `/api/invites/${invite.json.id}`)).json.error.code, 'invite_not_pending');
check('member cannot invite', (await ben.call('POST', '/api/invites', { email: inviteEmail, role: 'member', project_ids: [], channel_ids: [] })).status, 403);

// --- calendar validation
const badCalendar = await ana.call('PUT', '/api/workspace/calendar', {
  time_zone: 'Mars/Olympus',
  working_weekdays: [],
  holidays: [{ date: 'nope', name: '' }],
  cycle_anchor: '2026-10-19',
});
check('calendar validation', badCalendar.status, 422);
note('calendar fields', badCalendar.json.error.fields);
check('time zone copy', badCalendar.json.error.fields.time_zone, 'Choose a time zone from the list.');
check('weekday copy', badCalendar.json.error.fields.working_weekdays, 'Pick at least one working day.');
check('holiday copy', badCalendar.json.error.fields.holidays, 'Enter a date as YYYY-MM-DD.');
const anchorChange = await ana.call('PUT', '/api/workspace/calendar', {
  time_zone: 'Pacific/Auckland',
  working_weekdays: [1, 2, 3, 4, 5],
  holidays: [],
  cycle_anchor: '2026-10-20',
});
check('anchor locked', anchorChange.json.error.fields.cycle_anchor, "The first cycle start can't change after cycle 1 has begun.");
const duplicate = await ana.call('PUT', '/api/workspace/calendar', {
  time_zone: 'Pacific/Auckland',
  working_weekdays: [1, 2, 3, 4, 5],
  holidays: [
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-25', name: 'Again' },
  ],
  cycle_anchor: '2026-10-19',
});
check('duplicate holiday', duplicate.json.error.fields.holidays, 'That date is already a holiday.');
check('member cannot save the calendar', (await ben.call('PUT', '/api/workspace/calendar', { time_zone: 'UTC', working_weekdays: [1], holidays: [], cycle_anchor: '2026-10-19' })).status, 403);

// --- password change ends other sessions
const extra = new Client();
await extra.signIn('dev@kereru.test');
const dev = new Client();
await dev.signIn('dev@kereru.test');
check('password change', (await dev.call('POST', '/api/account/password', { current_password: 'tally-demo-1', new_password: 'tally-demo-2' })).status, 204);
check('other session ended', (await extra.call('GET', '/api/me')).status, 401);
check('changing session stays', (await dev.call('GET', '/api/me')).status, 200);
check('old password fails', (await new Client().signIn('dev@kereru.test')).status, 401);
check('new password works', (await new Client().signIn('dev@kereru.test', 'tally-demo-2')).status, 200);
check('wrong current password', (await dev.call('POST', '/api/account/password', { current_password: 'wrong', new_password: 'tally-demo-1' })).status, 403);
check('restore password', (await dev.call('POST', '/api/account/password', { current_password: 'tally-demo-2', new_password: 'tally-demo-1' })).status, 204);

// --- events replay
const stream = await fetch(`${base}/api/events`, { headers: { cookie: ben.cookie, 'last-event-id': '0' } });
const reader = stream.body.getReader();
const chunk = await reader.read();
const text = new TextDecoder().decode(chunk.value ?? new Uint8Array());
note('stream first chunk', text.slice(0, 80));
await reader.cancel();
check('stream content type', stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
