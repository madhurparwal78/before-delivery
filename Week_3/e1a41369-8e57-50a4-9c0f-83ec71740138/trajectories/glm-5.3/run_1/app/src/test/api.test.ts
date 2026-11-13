import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/server.js';
import { config } from '../server/config.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

/**
 * API integration tests: exercise the built app in-process against the real
 * Postgres. Each test group creates its own users via signup so the runs are
 * independent of seed data.
 */

interface Res {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}

function makeClient(app: http.Server): {
  request: (method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>) => Promise<Res>;
  close: () => Promise<void>;
} {
  const server = app;
  const serverInfo = server.address() as { port: number };
  const port = serverInfo.port;
  return {
    async request(method, path, body, cookie, headers) {
      const payload = body === undefined ? null : JSON.stringify(body);
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...(headers ?? {}),
        },
        body: payload ?? undefined,
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : undefined;
      const h: Record<string, string | string[] | undefined> = {};
      res.headers.forEach((v, k) => (h[k] = v));
      return { status: res.status, body: parsed, headers: h };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function startApp(): Promise<{ client: ReturnType<typeof makeClient>; server: http.Server }> {
  const app = buildApp();
  const server = http.createServer(app as unknown as (req: IncomingMessage, res: ServerResponse) => void);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return { client: makeClient(server), server };
}

let nextUser = 0;
async function newUser(client: ReturnType<typeof makeClient>['request']): Promise<{ cookie: string; me: any }> {
  const name = `t_${Date.now().toString(36)}_${nextUser++}`;
  const res = await client('POST', '/api/auth/signup', { username: name, password: 'password123' });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
  return { cookie, me: res.body };
}

test('auth: signup, login, logout, and error shapes', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());

  const badName = await client.request('POST', '/api/auth/signup', { username: 'A', password: 'x' });
  assert.equal(badName.status, 422);
  assert.deepEqual(badName.body, {
    errors: {
      username: 'Use 3 to 20 lowercase letters, digits or _.',
      password: 'Use at least 8 characters.',
    },
  });

  const created = await client.request('POST', '/api/auth/signup', { username: `au_${Date.now().toString(36)}`, password: 'password123' });
  assert.equal(created.status, 201);
  const cookie = String(created.headers['set-cookie'] ?? '');
  assert.match(cookie, /deed_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const taken = await client.request('POST', '/api/auth/signup', { username: created.body.username, password: 'password123' });
  assert.equal(taken.status, 409);
  assert.deepEqual(taken.body, { error: 'username_taken' });

  const wrong = await client.request('POST', '/api/auth/login', { username: created.body.username, password: 'nope-nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: 'invalid_credentials' });

  const ok = await client.request('POST', '/api/auth/login', { username: created.body.username, password: 'password123' });
  assert.equal(ok.status, 200);

  const out = await client.request('POST', '/api/auth/logout', {}, String(created.headers['set-cookie'] ?? '').split(';')[0]);
  assert.equal(out.status, 204);
});

test('unauthenticated requests answer 401 with the published body', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const res = await client.request('GET', '/api/tasks');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'unauthenticated' });
  const res2 = await client.request('GET', '/api/quests/00000000-0000-0000-0000-000000000000');
  assert.equal(res2.status, 401);
});

test('cross-origin state changes are refused', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const res = await client.request('POST', '/api/auth/login', { username: 'x', password: 'y' }, undefined, {
    Origin: 'http://evil.example',
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'cross_origin' });
});

test('wrong content type on a JSON endpoint answers 415', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { error: 'unsupported_media_type' });
});

test('tasks: create, edit stale protection, delete, move', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const { cookie, request } = { cookie: (await newUser(client.request)).cookie, request: client.request };

  const created = await request('POST', '/api/tasks', { type: 'habit', title: 'A habit', difficulty: 'easy' }, cookie);
  assert.equal(created.status, 201);
  assert.equal(created.body.position, 1);
  assert.equal(created.body.band, 'Sand');
  assert.equal(created.body.updatedAt !== undefined, true);

  const daily = await request('POST', '/api/tasks', { type: 'daily', title: 'A daily', difficulty: 'easy', weekdays: ['Mon'] }, cookie);
  assert.equal(daily.status, 201);
  assert.deepEqual(daily.body.weekdays, ['Mon']);
  assert.equal(daily.body.dueToday !== null, true);

  const todo = await request('POST', '/api/tasks', { type: 'todo', title: 'A todo', difficulty: 'hard', checklist: ['one', 'two'] }, cookie);
  assert.equal(todo.status, 201);
  assert.equal(todo.body.checklist.length, 2);
  assert.equal(todo.body.checklist[0].checked, false);

  const reward = await request('POST', '/api/tasks', { type: 'reward', title: 'A reward', difficulty: 'easy', price: 3.5 }, cookie);
  assert.equal(reward.status, 201);
  assert.equal(reward.body.price, 3.5);

  // validation shapes
  const badDaily = await request('POST', '/api/tasks', { type: 'daily', title: 'x', difficulty: 'easy', weekdays: [] }, cookie);
  assert.equal(badDaily.status, 422);
  assert.deepEqual(badDaily.body, { errors: { weekdays: 'Choose at least one weekday.' } });
  const badPrice = await request('POST', '/api/tasks', { type: 'reward', title: 'x', difficulty: 'easy', price: 0 }, cookie);
  assert.equal(badPrice.status, 422);
  assert.deepEqual(badPrice.body, { errors: { price: 'Price must be from 0.01 to 9999.99.' } });

  // stale edit
  const stale = await request('PATCH', `/api/tasks/${created.body.id}`, { updatedAt: '2020-01-01T00:00:00.000Z', title: 'nope' }, cookie);
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: 'stale_task' });

  const fresh = await request('PATCH', `/api/tasks/${created.body.id}`, { updatedAt: created.body.updatedAt, title: 'Renamed' }, cookie);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.title, 'Renamed');

  // checklist rewrite: keep one, add one, drop one
  const keep = todo.body.checklist[0];
  const rewritten = await request('PATCH', `/api/tasks/${todo.body.id}`, {
    updatedAt: todo.body.updatedAt,
    checklist: [{ id: keep.id, text: 'kept' }, { text: 'added' }],
  }, cookie);
  assert.equal(rewritten.status, 200);
  assert.equal(rewritten.body.checklist.length, 2);
  assert.equal(rewritten.body.checklist[0].text, 'kept');
  assert.equal(rewritten.body.checklist[0].id, keep.id);
  assert.equal(rewritten.body.checklist[0].checked, false);
  assert.equal(rewritten.body.checklist[1].text, 'added');

  // move: second habit? create one more then move to position 1
  const second = await request('POST', '/api/tasks', { type: 'habit', title: 'B habit', difficulty: 'easy' }, cookie);
  const moved = await request('POST', `/api/tasks/${second.body.id}/move`, { position: 1 }, cookie);
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body.tasks.map((x: any) => x.title), ['B habit', 'Renamed']);
  assert.deepEqual(moved.body.tasks.map((x: any) => x.position), [1, 2]);

  const badMove = await request('POST', `/api/tasks/${second.body.id}/move`, { position: 3 }, cookie);
  assert.equal(badMove.status, 422);
  assert.deepEqual(badMove.body, { errors: { position: 'Position must be from 1 to 2.' } });

  // delete shifts positions
  const gone = await request('DELETE', `/api/tasks/${second.body.id}`, undefined, cookie);
  assert.equal(gone.status, 204);
  const after = await request('GET', '/api/tasks', undefined, cookie);
  assert.equal(after.body.habits.length, 1);
  assert.equal(after.body.habits[0].position, 1);
});

test('actions: score, complete, undo, buy, ledger', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const { cookie, request } = { cookie: (await newUser(client.request)).cookie, request: client.request };

  const habit = await request('POST', '/api/tasks', { type: 'habit', title: 'H', difficulty: 'easy' }, cookie);
  const up = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'up' }, cookie);
  assert.equal(up.status, 200);
  assert.equal(up.body.delta.experience, 10);
  assert.equal(up.body.delta.gold, 1);
  assert.equal(up.body.delta.health, 0);
  assert.equal(up.body.task.value, 1);
  assert.equal(up.body.task.band, 'Sand');

  const down = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'down' }, cookie);
  assert.equal(down.status, 200);
  assert.equal(down.body.delta.health, -2);
  assert.equal(down.body.task.value, 0);

  const wrongDir = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'sideways' }, cookie);
  assert.equal(wrongDir.status, 422);
  assert.deepEqual(wrongDir.body, { errors: { direction: 'Direction must be up or down.' } });

  // complete a daily
  const daily = await request('POST', '/api/tasks', { type: 'daily', title: 'D', difficulty: 'easy', weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }, cookie);
  const done = await request('POST', `/api/tasks/${daily.body.id}/complete`, {}, cookie);
  assert.equal(done.status, 200);
  assert.equal(done.body.delta.experience, 10);
  const again = await request('POST', `/api/tasks/${daily.body.id}/complete`, {}, cookie);
  assert.equal(again.status, 409);
  assert.deepEqual(again.body, { error: 'already_done' });

  // undo inside the window reverts exactly
  const before = await request('GET', '/api/me', undefined, cookie);
  const undone = await request('POST', `/api/tasks/${daily.body.id}/uncomplete`, {}, cookie);
  assert.equal(undone.status, 200);
  const after = await request('GET', '/api/me', undefined, cookie);
  assert.equal(after.body.experience, before.body.experience - done.body.delta.experience);
  assert.equal(Math.round(after.body.gold * 100), Math.round((before.body.gold - done.body.delta.gold) * 100));
  assert.equal(undone.body.task.value, daily.body.value);
  assert.equal(undone.body.task.done, false);

  const notDone = await request('POST', `/api/tasks/${daily.body.id}/uncomplete`, {}, cookie);
  assert.equal(notDone.status, 409);
  assert.deepEqual(notDone.body, { error: 'not_done' });

  // checklist to-do: tick gives nothing, bonus applies at completion
  const todo = await request('POST', '/api/tasks', { type: 'todo', title: 'T', difficulty: 'hard', checklist: ['a', 'b'] }, cookie);
  const tick = await request('PATCH', `/api/tasks/${todo.body.id}/checklist/${todo.body.checklist[0].id}`, { checked: true }, cookie);
  assert.equal(tick.status, 200);
  const me1 = await request('GET', '/api/me', undefined, cookie);
  assert.equal(me1.body.gold, after.body.gold); // no gold for a checklist tick
  const completed = await request('POST', `/api/tasks/${todo.body.id}/complete`, {}, cookie);
  // hard, value 0, 1 of 2 checked: round(10*2*1*(1+0.5*0.5)) = 25
  assert.equal(completed.body.delta.experience, 25);
  assert.equal(completed.body.delta.gold, 2.5);

  // rewards: price equal to balance is allowed, above is refused
  const goldNow = (await request('GET', '/api/me', undefined, cookie)).body.gold;
  const exact = await request('POST', '/api/tasks', { type: 'reward', title: 'R1', difficulty: 'easy', price: goldNow }, cookie);
  const bought = await request('POST', `/api/rewards/${exact.body.id}/buy`, {}, cookie);
  assert.equal(bought.status, 200);
  assert.equal(bought.body.delta.gold, -goldNow);
  const zeroNow = (await request('GET', '/api/me', undefined, cookie)).body.gold;
  assert.equal(zeroNow, 0);

  const pricey = await request('POST', '/api/tasks', { type: 'reward', title: 'R2', difficulty: 'easy', price: 0.01 }, cookie);
  const refused = await request('POST', `/api/rewards/${pricey.body.id}/buy`, {}, cookie);
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body, { errors: { gold: 'Not enough gold.' } });

  // ledger balance equals the sum of entries
  const ledger = await request('GET', '/api/gold/ledger', undefined, cookie);
  const sum = ledger.body.entries.reduce((s: number, e: any) => s + Math.round(e.amount * 100), 0) / 100;
  assert.equal(ledger.body.balance, sum);
  assert.equal(ledger.body.balance, 0);
  const kinds = ledger.body.entries.map((e: any) => e.kind);
  assert.equal(kinds.includes('task'), true);
  assert.equal(kinds.includes('undo'), true);
  assert.equal(kinds.includes('reward'), true);
});

test('idempotency: repeat returns the stored response; different request answers 409', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const { cookie, request } = { cookie: (await newUser(client.request)).cookie, request: client.request };

  const habit = await request('POST', '/api/tasks', { type: 'habit', title: 'H', difficulty: 'easy' }, cookie);
  const key = `idem-${Date.now()}`;
  const first = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'up' }, cookie, { 'Idempotency-Key': key });
  assert.equal(first.status, 200);
  const second = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'up' }, cookie, { 'Idempotency-Key': key });
  assert.equal(second.status, 200);
  assert.equal(second.body.player.gold, first.body.player.gold);
  assert.equal(second.body.task.value, first.body.task.value);

  const other = await request('POST', `/api/tasks/${habit.body.id}/score`, { direction: 'down' }, cookie, { 'Idempotency-Key': key });
  assert.equal(other.status, 409);
  assert.deepEqual(other.body, { error: 'idempotency_key_reused' });
});

test('parties and quests: lifecycle and error order', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const req = client.request;
  const a = await newUser(req);
  const b = await newUser(req);

  // a forms a party
  const party = await req('POST', '/api/parties', { name: 'Test Crew' }, a.cookie);
  assert.equal(party.status, 201);
  assert.equal(party.body.leader, a.me.username);
  assert.equal(party.body.members.length, 1);

  // non-member cannot see the party (404, not 403)
  const strangerView = await req('GET', `/api/parties/${party.body.id}`, undefined, b.cookie);
  assert.equal(strangerView.status, 404);
  assert.deepEqual(strangerView.body, { error: 'not_found' });

  // invite, accept
  const invite = await req('POST', `/api/parties/${party.body.id}/invites`, { username: b.me.username }, a.cookie);
  assert.equal(invite.status, 201);
  const invites = await req('GET', '/api/invites', undefined, b.cookie);
  assert.equal(invites.body.invites.length, 1);
  const joined = await req('POST', `/api/invites/${invites.body.invites[0].id}/accept`, {}, b.cookie);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.members.length, 2);

  // fixtures listing
  const fixtures = await req('GET', '/api/quest-fixtures', undefined, a.cookie);
  assert.equal(fixtures.body.quests.length, 3);
  assert.equal(fixtures.body.quests[0].name, 'Wake the Drowsewyrm');

  // quest lifecycle
  const invited = await req('POST', `/api/parties/${party.body.id}/quests`, { quest: 'Hush the Clutterhound' }, a.cookie);
  assert.equal(invited.status, 201);
  assert.equal(invited.body.state, 'invited');
  const questId = invited.body.id;

  const early = await req('POST', `/api/quests/${questId}/begin`, {}, a.cookie);
  assert.equal(early.status, 409);
  assert.deepEqual(early.body, { error: 'not_enough_accepted' });

  const accepted = await req('POST', `/api/quests/${questId}/accept`, {}, b.cookie);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.acceptedBy.includes(b.me.username), true);

  const begun = await req('POST', `/api/quests/${questId}/begin`, {}, a.cookie);
  assert.equal(begun.status, 200);
  assert.equal(begun.body.state, 'active');

  // every other move refuses
  const acceptActive = await req('POST', `/api/quests/${questId}/accept`, {}, b.cookie);
  assert.equal(acceptActive.status, 409);
  assert.deepEqual(acceptActive.body, { error: 'quest_not_active' });
  const beginActive = await req('POST', `/api/quests/${questId}/begin`, {}, a.cookie);
  assert.deepEqual(beginActive.body, { error: 'quest_not_active' });
  const inProgress = await req('POST', `/api/parties/${party.body.id}/quests`, { quest: 'Wake the Drowsewyrm' }, a.cookie);
  assert.equal(inProgress.status, 409);
  assert.deepEqual(inProgress.body, { error: 'quest_in_progress' });

  // member cannot abandon
  const memberAbandon = await req('POST', `/api/quests/${questId}/abandon`, {}, b.cookie);
  assert.equal(memberAbandon.status, 403);
  assert.deepEqual(memberAbandon.body, { error: 'leader_only' });

  const abandoned = await req('POST', `/api/quests/${questId}/abandon`, {}, a.cookie);
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.body.state, 'abandoned');

  // abandoned quest appears in history
  const history = await req('GET', '/api/history', undefined, a.cookie);
  assert.equal(history.body.quests.length, 1);
  assert.equal(history.body.quests[0].state, 'abandoned');
});

test('chat: rate limit and validation', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const req = client.request;
  const a = await newUser(req);
  const party = await req('POST', '/api/parties', { name: 'Chat Crew' }, a.cookie);

  const empty = await req('POST', `/api/parties/${party.body.id}/chat`, { text: '   ' }, a.cookie);
  assert.equal(empty.status, 422);
  assert.deepEqual(empty.body, { errors: { text: 'Message must be 1 to 500 characters.' } });

  const long = await req('POST', `/api/parties/${party.body.id}/chat`, { text: 'x'.repeat(501) }, a.cookie);
  assert.equal(long.status, 422);

  // config.chatMaxPerMinute messages, then 429
  const limit = config.chatMaxPerMinute;
  for (let i = 0; i < limit; i++) {
    const res = await req('POST', `/api/parties/${party.body.id}/chat`, { text: `m${i}` }, a.cookie);
    assert.equal(res.status, 201);
  }
  const limited = await req('POST', `/api/parties/${party.body.id}/chat`, { text: 'one too many' }, a.cookie);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: 'chat_rate_limited' });

  const log = await req('GET', `/api/parties/${party.body.id}/chat`, undefined, a.cookie);
  assert.equal(log.body.messages.length, limit);
});

test('settings: validation and next day start', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const req = client.request;
  const a = await newUser(req);

  const badZone = await req('PATCH', '/api/settings', { timeZone: 'Mars/Olympus' }, a.cookie);
  assert.equal(badZone.status, 422);
  assert.deepEqual(badZone.body, { errors: { timeZone: 'Unknown time zone.' } });

  const badHour = await req('PATCH', '/api/settings', { dayStartHour: 24 }, a.cookie);
  assert.deepEqual(badHour.body, { errors: { dayStartHour: 'Day start hour must be a whole number from 0 to 23.' } });

  const good = await req('PATCH', '/api/settings', { timeZone: 'America/Toronto', dayStartHour: 6 }, a.cookie);
  assert.equal(good.status, 200);
  assert.equal(good.body.timeZone, 'America/Toronto');
  assert.equal(good.body.dayStartHour, 6);
  assert.match(good.body.nextDayStart, /^... 06:00 \(America\/Toronto\)$/);
});

test('grading routes: token guard and setup validation', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  const req = client.request;

  const noToken = await req('POST', '/api/grading/setup', {});
  assert.equal(noToken.status, 404);
  const badToken = await req('POST', '/api/grading/setup', {}, undefined, { 'X-Grading-Token': 'wrong' });
  assert.equal(badToken.status, 404);
});

test('server boundary: blocked paths answer 404', async (t) => {
  const { client, server } = await startApp();
  t.after(() => client.close());
  for (const p of ['/package.json', '/run.json', '/.env', '/package-lock.json']) {
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${p}`);
    assert.equal(res.status, 404, `${p} should not be served`);
  }
});
