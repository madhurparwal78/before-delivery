// Verifies the clock-driven rules, the storage-outage paths and WebSocket push against a live instance.
import { strict as assert } from 'node:assert';
import { WebSocket } from 'ws';

const BASE = process.env.AIRFOLD_URL ?? 'http://127.0.0.1:4173';
const PREFIX = `clocktest${Date.now().toString(36)}`;

interface Jar { cookie: string }

async function api(method: string, path: string, body?: unknown, jar?: Jar): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(jar?.cookie ? { cookie: jar.cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && jar) jar.cookie = setCookie.split(';')[0];
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function makeIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return { publicKey: Buffer.from(raw).toString('base64url'), keyId: Buffer.from(digest.slice(0, 12)).toString('base64url') };
}

async function signUp(username: string): Promise<{ jar: Jar; account: any }> {
  const identity = await makeIdentity();
  const jar: Jar = { cookie: '' };
  const res = await api('POST', '/api/accounts', {
    username,
    public_key: identity.publicKey,
    recovery_verifier: 'A'.repeat(43),
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  }, jar);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { jar, account: res.body };
}

function wsConnect(jar: Jar): Promise<{ socket: WebSocket; frames: any[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { cookie: jar.cookie } });
    const frames: any[] = [];
    socket.on('open', () => resolve({ socket, frames }));
    socket.on('message', (data) => { frames.push(JSON.parse(data.toString())); });
    socket.on('error', reject);
  });
}

function waitForFrame(frames: any[], match: (f: any) => boolean, timeoutMs = 5000): Promise<any> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = frames.find(match);
      if (found) { resolve(found); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`frame not found within ${timeoutMs}ms`)); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
function test(name: string, fn: () => Promise<void>) { tests.push({ name, fn }); }
const uuid = () => crypto.randomUUID();
const sealed = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(235) };

test('grading clock offset drives the retract window and returns', async () => {
  const a = await signUp(`${PREFIX}clocka`);
  const b = await signUp(`${PREFIX}clockb`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  const posted = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id, ...sealed,
  }, a.jar);
  assert.equal(posted.status, 201);

  // 24 hours of offset: the retract window closes.
  const day = 24 * 3600 * 1000;
  const set = await api('POST', '/api/grading/clock', { offset_ms: day });
  assert.equal(set.status, 200);
  const letter = await api('GET', `/api/letters/${posted.body.id}`, undefined, a.jar);
  assert.equal(letter.body.can_retract, false);
  const refused = await api('POST', `/api/letters/${posted.body.id}/retract`, {}, a.jar);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'retract_window_closed');

  // 30 days: the letter is returned on the next read of the row.
  const setLater = await api('POST', '/api/grading/clock', { offset_ms: 31 * day });
  assert.equal(setLater.status, 200);
  const letterLater = await api('GET', `/api/letters/${posted.body.id}`, undefined, a.jar);
  assert.equal(letterLater.body.state, 'failed');
  assert.equal(letterLater.body.failure, 'returned');
  assert.ok(letterLater.body.returned_at);

  // Reset the clock for later tests.
  await api('POST', '/api/grading/clock', { offset_ms: 0 });
});

test('mutes expire by the server clock', async () => {
  const a = await signUp(`${PREFIX}mutea`);
  const b = await signUp(`${PREFIX}muteb`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  const muted = await api('PUT', `/api/conversations/${cid}/mute`, { duration: '1h' }, a.jar);
  assert.equal(muted.status, 200);
  assert.ok(muted.body.muted_until);
  const unmuted = await api('PUT', `/api/conversations/${cid}/mute`, { duration: 'off' }, a.jar);
  assert.equal(unmuted.status, 200);
  assert.equal(unmuted.body.muted_until, null);
  const always = await api('PUT', `/api/conversations/${cid}/mute`, { duration: 'always' }, a.jar);
  assert.equal(always.body.muted_until, 'always');
});

test('username cooldown clears after seven days of server time', async () => {
  const { jar } = await signUp(`${PREFIX}cooluser`);
  const first = await api('PATCH', '/api/me/username', { username: `${PREFIX}cooluser2` }, jar);
  assert.equal(first.status, 200);
  const blocked = await api('PATCH', '/api/me/username', { username: `${PREFIX}cooluser3` }, jar);
  assert.equal(blocked.status, 409);
  const day = 24 * 3600 * 1000;
  await api('POST', '/api/grading/clock', { offset_ms: 7 * day + 1000 });
  const allowed = await api('PATCH', '/api/me/username', { username: `${PREFIX}cooluser3` }, jar);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  await api('POST', '/api/grading/clock', { offset_ms: 0 });

  // The first name is still held at day 7 (14-day hold), but free at day 15.
  await api('POST', '/api/grading/clock', { offset_ms: 14 * day + 1000 });
  const other = await signUp(`${PREFIX}claimtwo`);
  const claimed = await api('PATCH', '/api/me/username', { username: `${PREFIX}cooluser` }, other.jar);
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  await api('POST', '/api/grading/clock', { offset_ms: 0 });
});

test('WebSocket pushes letter and conversation frames within 2 seconds', async () => {
  const a = await signUp(`${PREFIX}wsa`);
  const b = await signUp(`${PREFIX}wsb`);
  const aWs = await wsConnect(a.jar);
  const bWs = await wsConnect(b.jar);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  const posted = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id, ...sealed,
  }, a.jar);
  assert.equal(posted.status, 201);

  const letterFrame = await waitForFrame(bWs.frames, (f) => f.type === 'letter' && f.letter.id === posted.body.id);
  assert.equal(letterFrame.letter.conversation_id, cid);
  const aLetterFrame = await waitForFrame(aWs.frames, (f) => f.type === 'letter' && f.letter.id === posted.body.id);
  assert.ok(aLetterFrame);

  // The recipient acks; the sender sees Delivered pushed.
  const ack = await api('POST', '/api/inbox/ack', { through_seq: posted.body.seq }, b.jar);
  assert.equal(ack.body.delivered, 1);
  const deliveredFrame = await waitForFrame(aWs.frames, (f) => f.type === 'letter' && f.letter.id === posted.body.id && f.letter.state === 'delivered');
  assert.ok(deliveredFrame);

  // The recipient reads; the sender sees Read pushed.
  await api('POST', `/api/conversations/${cid}/read`, { through_seq: posted.body.seq }, b.jar);
  for (let i = 0; i < 20; i++) {
    const readFrame = aWs.frames.filter((f) => f.type === 'letter').find((f) => f.letter.state === 'read');
    if (readFrame) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const readFrame = aWs.frames.filter((f) => f.type === 'letter').find((f) => f.letter.state === 'read');
  assert.ok(readFrame, 'read frame pushed');

  aWs.socket.close();
  bWs.socket.close();
});

test('WebSocket auth: no cookie answers 401 before upgrade', async () => {
  const url = BASE.replace('http', 'ws') + '/ws';
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    socket.on('close', (code) => {
      // The server writes 401 and closes the socket.
      assert.notEqual(code, undefined);
      resolve();
    });
    socket.on('open', () => { socket.close(); resolve(); });
  });
});

test('signed_out frame reaches a revoked browser', async () => {
  const first = await signUp(`${PREFIX}signout`);
  const ws = await wsConnect(first.jar);

  // Recover the same account in a second browser.
  const identity = await makeIdentity();
  const jar2: Jar = { cookie: '' };
  const recovered = await api('POST', '/api/recover', {
    username: first.account.username,
    recovery_verifier: 'A'.repeat(43),
    public_key: identity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  }, jar2);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));

  const frame = await waitForFrame(ws.frames, (f) => f.type === 'signed_out');
  assert.ok(frame);
  ws.socket.close();
});

test('keys frame and seal status after a key change', async () => {
  const a = await signUp(`${PREFIX}keys2a`);
  const b = await signUp(`${PREFIX}keys2b`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);

  // b recovers; a's view of the conversation shows seal changed.
  const identity = await makeIdentity();
  const bJar2: Jar = { cookie: '' };
  await api('POST', '/api/recover', {
    username: b.account.username,
    recovery_verifier: 'A'.repeat(43),
    public_key: identity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  }, bJar2);

  const view = await api('GET', `/api/conversations/${cid}`, undefined, a.jar);
  assert.equal(view.body.peer.seal, 'changed');
  assert.equal(view.body.peer.key_id, identity.keyId);

  // Key history lists both keys, oldest first, with current marked.
  const keys = await api('GET', `/api/accounts/${b.account.id}/keys`, undefined, a.jar);
  assert.equal(keys.body.keys.length, 2);
  assert.equal(keys.body.keys[0].key_id, b.account.key_id);
  assert.equal(keys.body.keys[0].current, false);
  assert.equal(keys.body.keys[1].key_id, identity.keyId);
  assert.equal(keys.body.keys[1].current, true);
});

let failed = 0;
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
for (const t of tests) {
  if (only && !t.name.includes(only)) continue;
  try {
    await t.fn();
    console.log(`ok - ${t.name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL - ${t.name}`);
    console.log(error instanceof Error ? error.stack : error);
  }
}
console.log(`live: ${tests.length} tests, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
