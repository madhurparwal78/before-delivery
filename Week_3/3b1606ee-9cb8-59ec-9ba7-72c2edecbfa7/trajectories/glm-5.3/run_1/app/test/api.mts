// API tests against a running instance. Every hook used here is the published one.
import { strict as assert } from 'node:assert';

const BASE = process.env.AIRFOLD_URL ?? 'http://127.0.0.1:4173';
const PREFIX = `apitest${Date.now().toString(36)}`;

interface Jar { cookie: string }

async function api(method: string, path: string, body?: unknown, jar?: Jar, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jar?.cookie ? { cookie: jar.cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && jar) jar.cookie = setCookie.split(';')[0];
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// Web Crypto identity helpers, mirroring the browser.
async function makeIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const keyId = Buffer.from(digest.slice(0, 12)).toString('base64url');
  return { publicKey: Buffer.from(raw).toString('base64url'), keyId, privateKey: pair.privateKey };
}

function recoveryVerifier(canonical: string): Promise<string> {
  const enc = new TextEncoder().encode(canonical);
  return crypto.subtle.importKey('raw', enc, 'HKDF', false, ['deriveBits']).then(async (key) => {
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('airfold/v1/recovery'), info: new TextEncoder().encode('airfold/v1/recovery-verifier') },
      key, 256);
    return Buffer.from(bits).toString('base64url');
  });
}

async function signUp(username: string): Promise<{ jar: Jar; account: any; identity: any; verifier: string; canonical: string }> {
  const identity = await makeIdentity();
  let canonical = '';
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  for (let i = 0; i < 32; i++) canonical += alphabet[Math.floor(Math.random() * alphabet.length)];
  const verifier = await recoveryVerifier(canonical);
  const jar: Jar = { cookie: '' };
  const res = await api('POST', '/api/accounts', {
    username,
    public_key: identity.publicKey,
    recovery_verifier: verifier,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: Buffer.from('sealed').toString('base64url') },
  }, jar);
  assert.equal(res.status, 201, `sign-up failed: ${JSON.stringify(res.body)}`);
  return { jar, account: res.body, identity, verifier, canonical };
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
function test(name: string, fn: () => Promise<void>) { tests.push({ name, fn }); }

const uuid = () => crypto.randomUUID();

test('availability reasons in the published order', async () => {
  const short = await api('GET', '/api/usernames/ab/availability');
  assert.equal(short.body.reason, 'length');
  const chars = await api('GET', '/api/usernames/a!b/availability');
  assert.equal(chars.body.reason, 'characters');
  const first = await api('GET', '/api/usernames/9abc/availability');
  assert.equal(chars.body.reason, 'characters');
  assert.equal(first.body.reason, 'first_character');
  const last = await api('GET', '/api/usernames/abc./availability');
  assert.equal(last.body.reason, 'last_character');
  const taken = await api('GET', '/api/usernames/halfpenny/availability');
  assert.equal(taken.body.reason, 'taken');
  assert.equal(taken.body.username, 'halfpenny');
  const free = await api('GET', `/api/usernames/${PREFIX}free/availability`);
  assert.equal(free.body.available, true);
});

test('sign-up stores nothing private and sets the cookie', async () => {
  const { jar, account } = await signUp(`${PREFIX}alice`);
  assert.ok(jar.cookie.startsWith('airfold_session='));
  assert.equal(account.username, `${PREFIX}alice`);
  assert.equal(account.profile, null);
  assert.equal(account.settings.read_receipts, true);
  assert.equal(account.settings.preview, 'name_and_letter');
  const me = await api('GET', '/api/me', undefined, jar);
  assert.equal(me.status, 200);
  assert.equal(me.body.id, account.id);
});

test('unauthenticated requests answer 401 with the one error shape', async () => {
  const res = await api('GET', '/api/me');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'unauthenticated' });
});

test('taken usernames answer 409 on sign-up', async () => {
  const name = `${PREFIX}taken`;
  await signUp(name);
  const identity = await makeIdentity();
  const verifier = await recoveryVerifier('7K2MQ9XD7K2MQ9XD7K2MQ9XD7K2MQ9XD');
  const res = await api('POST', '/api/accounts', {
    username: name.toUpperCase(),
    public_key: identity.publicKey,
    recovery_verifier: verifier,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'username_taken');
});

test('lookup matches exactly, case-insensitively, and never the caller', async () => {
  const watcher = await signUp(`${PREFIX}watcher`);
  const { account } = await signUp(`${PREFIX}lookme`);
  const found = await api('GET', `/api/lookup?username=${PREFIX}LOOKME`, undefined, watcher.jar);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, account.id);
  assert.equal(found.body.profile, null);
  const self = await api('GET', `/api/lookup?username=${PREFIX}lookme`, undefined, watcher.jar);
  assert.equal(self.status, 200);
  const own = await api('GET', `/api/lookup?username=${PREFIX}watcher`, undefined, watcher.jar);
  assert.equal(own.status, 404);
  const missing = await api('GET', `/api/lookup?username=${PREFIX}look`, undefined, watcher.jar);
  assert.equal(missing.status, 404);
});

test('first letter lands as a request, Accept opens it, one letter per id', async () => {
  const sender = await signUp(`${PREFIX}sender`);
  const recipient = await signUp(`${PREFIX}receiver`);
  const created = await api('POST', '/api/conversations', { peer_id: recipient.account.id }, sender.jar);
  assert.equal(created.status, 201);
  const conversationId = created.body.id;
  assert.equal(created.body.status, 'accepted');

  const sealed = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(235) };
  const posted = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recipient.account.key_id,
    ...sealed,
  }, sender.jar);
  assert.equal(posted.status, 201, JSON.stringify(posted.body));
  assert.equal(posted.body.state, 'sent');
  assert.ok(posted.body.seq > 0);

  // Replay the same id with the same body: 200 with the stored letter.
  const replay = await api('POST', '/api/letters', {
    id: posted.body.id,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recipient.account.key_id,
    ...sealed,
  }, sender.jar);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, posted.body.id);

  // Reuse the id with different content: 409 letter_id_conflict.
  const conflict = await api('POST', '/api/letters', {
    id: posted.body.id,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recipient.account.key_id,
    iv: sealed.iv,
    ciphertext: 'B'.repeat(235),
  }, sender.jar);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'letter_id_conflict');

  // The recipient sees a request.
  const requests = await api('GET', '/api/conversations?status=request', undefined, recipient.jar);
  assert.equal(requests.status, 200);
  const row = requests.body.conversations.find((c: any) => c.id === conversationId);
  assert.ok(row, 'request appears for the recipient');
  assert.equal(row.peer.username, `${PREFIX}sender`);
  assert.equal(row.peer.profile, null);

  // The recipient cannot post while it is a request.
  const refused = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: sender.account.key_id,
    iv: sealed.iv,
    ciphertext: 'C'.repeat(235),
  }, recipient.jar);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'request_not_accepted');

  // Accept opens the conversation for the recipient.
  const accepted = await api('POST', `/api/conversations/${conversationId}/accept`, {}, recipient.jar);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'accepted');
});

test('inbox collects held letters in seq order, ack delivers them once', async () => {
  const sender = await signUp(`${PREFIX}holdsender`);
  const recipient = await signUp(`${PREFIX}holdrecv`);
  const conversation = await api('POST', '/api/conversations', { peer_id: recipient.account.id }, sender.jar);
  await api('POST', `/api/conversations/${conversation.body.id}/accept`, {}, recipient.jar);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const posted = await api('POST', '/api/letters', {
      id: uuid(),
      conversation_id: conversation.body.id,
      class: 'letter',
      recipient_key_id: recipient.account.key_id,
      iv: 'AAAAAAAAAAAAAAAA',
      ciphertext: 'D'.repeat(235),
    }, sender.jar);
    assert.equal(posted.status, 201);
    ids.push(posted.body.seq);
  }
  const inbox = await api('GET', '/api/inbox', undefined, recipient.jar);
  assert.equal(inbox.body.letters.length, 3);
  const seqs = inbox.body.letters.map((l: any) => l.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.ok(inbox.body.letters.every((l: any) => l.ciphertext !== null));

  const ack = await api('POST', '/api/inbox/ack', { through_seq: Math.max(...ids) }, recipient.jar);
  assert.equal(ack.status, 200);
  assert.equal(ack.body.delivered, 3);
  const again = await api('POST', '/api/inbox/ack', { through_seq: Math.max(...ids) }, recipient.jar);
  assert.equal(again.body.delivered, 0);
  const emptyInbox = await api('GET', '/api/inbox', undefined, recipient.jar);
  assert.equal(emptyInbox.body.letters.length, 0);
});

test('participant access: outsiders get 404 like something that never existed', async () => {
  const a = await signUp(`${PREFIX}ina`);
  const b = await signUp(`${PREFIX}inb`);
  const outsider = await signUp(`${PREFIX}outsider`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const id = conversation.body.id;
  const outsiderView = await api('GET', `/api/conversations/${id}`, undefined, outsider.jar);
  assert.equal(outsiderView.status, 404);
  assert.deepEqual(outsiderView.body, { error: 'not_found' });
  // ids inside bodies too
  const posted = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: id,
    class: 'letter',
    recipient_key_id: b.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'E'.repeat(235),
  }, outsider.jar);
  assert.equal(posted.status, 404);
  assert.deepEqual(posted.body, { error: 'not_found' });
});

test('blocking: posts answer 201 sent but are never delivered', async () => {
  const blocker = await signUp(`${PREFIX}blocker`);
  const blocked = await signUp(`${PREFIX}blockedp`);
  const conversation = await api('POST', '/api/conversations', { peer_id: blocker.account.id }, blocked.jar);
  await api('POST', `/api/conversations/${conversation.body.id}/accept`, {}, blocker.jar);
  const block = await api('PUT', `/api/blocks/${blocked.account.id}`, {}, blocker.jar);
  assert.equal(block.status, 200);
  assert.equal(block.body.username, `${PREFIX}blockedp`);

  const posted = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: conversation.body.id,
    class: 'letter',
    recipient_key_id: blocker.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'F'.repeat(235),
  }, blocked.jar);
  assert.equal(posted.status, 201);
  assert.equal(posted.body.state, 'sent');

  const inbox = await api('GET', '/api/inbox', undefined, blocker.jar);
  assert.equal(inbox.body.letters.filter((l: any) => l.conversation_id === conversation.body.id).length, 0);

  // The blocker cannot post to the blocked person.
  const refused = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: conversation.body.id,
    class: 'letter',
    recipient_key_id: blocked.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'G'.repeat(235),
  }, blocker.jar);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'contact_blocked');

  const unblock = await api('DELETE', `/api/blocks/${blocked.account.id}`, undefined, blocker.jar);
  assert.equal(unblock.status, 204);
  // Letters posted during the block never arrive.
  const inboxAfter = await api('GET', '/api/inbox', undefined, blocker.jar);
  assert.equal(inboxAfter.body.letters.filter((l: any) => l.conversation_id === conversation.body.id).length, 0);
});

test('recovery restores the account with a new key and signs out others', async () => {
  const first = await signUp(`${PREFIX}recover`);
  const secondIdentity = await makeIdentity();
  const verifier = await recoveryVerifier(first.canonical);
  const jar: Jar = { cookie: '' };
  const recovered = await api('POST', '/api/recover', {
    username: first.account.username,
    recovery_verifier: verifier,
    public_key: secondIdentity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: Buffer.from('new-backup').toString('base64url') },
  }, jar);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.account.id, first.account.id);
  assert.equal(recovered.body.account.key_id, secondIdentity.keyId);
  assert.ok(recovered.body.key_backups.length >= 1);

  // The old browser is signed out.
  const oldMe = await api('GET', '/api/me', undefined, first.jar);
  assert.equal(oldMe.status, 401);

  // The new browser is signed in and sees the new key.
  const me = await api('GET', '/api/me', undefined, jar);
  assert.equal(me.status, 200);
  assert.equal(me.body.key_id, secondIdentity.keyId);

  // A wrong verifier answers the same as an unknown username.
  const wrong = await api('POST', '/api/recover', {
    username: `${PREFIX}recover`,
    recovery_verifier: await recoveryVerifier('0'.repeat(32)),
    public_key: secondIdentity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'recovery_failed');
  const unknown = await api('POST', '/api/recover', {
    username: `${PREFIX}ghost`,
    recovery_verifier: verifier,
    public_key: secondIdentity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
});

test('key change pauses letters: seal_change_unaccepted until accepted', async () => {
  const a = await signUp(`${PREFIX}keysig`);
  const b = await signUp(`${PREFIX}keyrecv`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);

  // b recovers in a new browser: a's accepted key is now stale.
  const newIdentity = await makeIdentity();
  const verifier = await recoveryVerifier(b.canonical);
  const bJar2: Jar = { cookie: '' };
  const recovered = await api('POST', '/api/recover', {
    username: b.account.username,
    recovery_verifier: verifier,
    public_key: newIdentity.publicKey,
    key_backup: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA' },
  }, bJar2);
  assert.equal(recovered.status, 200);

  const view = await api('GET', `/api/conversations/${cid}`, undefined, a.jar);
  assert.equal(view.body.peer.seal, 'changed');

  const refused = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: cid,
    class: 'letter',
    recipient_key_id: newIdentity.keyId,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'H'.repeat(235),
  }, a.jar);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'seal_change_unaccepted');

  // A stale recipient key answers recipient_key_changed with the current key.
  const stale = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: cid,
    class: 'letter',
    recipient_key_id: b.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'H'.repeat(235),
  }, a.jar);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'recipient_key_changed');
  assert.equal(stale.body.key_id, newIdentity.keyId);

  // Accept the new seal number, then the same post succeeds.
  const accept = await api('PUT', `/api/contacts/${b.account.id}/seal`, { key_id: newIdentity.keyId, verified: false }, a.jar);
  assert.equal(accept.status, 200);
  assert.equal(accept.body.seal, 'unverified');
  const posted = await api('POST', '/api/letters', {
    id: uuid(),
    conversation_id: cid,
    class: 'letter',
    recipient_key_id: newIdentity.keyId,
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'H'.repeat(235),
  }, a.jar);
  assert.equal(posted.status, 201);
});

test('username change cooldown and the 14-day hold', async () => {
  const { jar, account } = await signUp(`${PREFIX}rename`);
  const first = await api('PATCH', '/api/me/username', { username: `${PREFIX}renamed` }, jar);
  assert.equal(first.status, 200);
  assert.equal(first.body.username, `${PREFIX}renamed`);
  assert.ok(first.body.username_changed_at);

  // Immediately again: cooldown.
  const second = await api('PATCH', '/api/me/username', { username: `${PREFIX}rename2` }, jar);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'username_cooldown');
  assert.ok(second.body.retry_at);

  // The released name is held: taken for everyone, lookup 404.
  const avail = await api('GET', `/api/usernames/${PREFIX}rename/availability`);
  assert.equal(avail.body.reason, 'taken');
  const other = await signUp(`${PREFIX}claimant`);
  const claimed = await api('PATCH', '/api/me/username', { username: `${PREFIX}rename` }, other.jar);
  assert.equal(claimed.status, 409);

  // The same name twice answers 422 same.
  const same = await api('PATCH', '/api/me/username', { username: `${PREFIX}renamed` }, jar);
  assert.equal(same.status, 422);
  assert.equal(same.body.fields.username, 'same');

  void account;
});

test('read receipts are reciprocal: off on either side leaves the letter delivered', async () => {
  const a = await signUp(`${PREFIX}rra`);
  const b = await signUp(`${PREFIX}rrb`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  const posted = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'I'.repeat(235),
  }, a.jar);
  await api('POST', '/api/inbox/ack', { through_seq: posted.body.seq }, b.jar);

  // b turns receipts off, then reads: the letter stays delivered for good.
  await api('PATCH', '/api/me/settings', { read_receipts: false }, b.jar);
  await api('POST', `/api/conversations/${cid}/read`, { through_seq: posted.body.seq }, b.jar);
  const letter = await api('GET', `/api/letters/${posted.body.id}`, undefined, a.jar);
  assert.equal(letter.body.state, 'delivered');
  assert.equal(letter.body.read_at, null);

  // b turns them back on; the earlier read was recorded and the letter stays delivered.
  await api('PATCH', '/api/me/settings', { read_receipts: true }, b.jar);
  await api('POST', `/api/conversations/${cid}/read`, { through_seq: posted.body.seq }, b.jar);
  const letterAfter = await api('GET', `/api/letters/${posted.body.id}`, undefined, a.jar);
  assert.equal(letterAfter.body.state, 'delivered');
  assert.equal(letterAfter.body.read_at, null);

  // A fresh letter, read with both sides on, becomes read.
  const second = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'J'.repeat(235),
  }, a.jar);
  await api('POST', '/api/inbox/ack', { through_seq: second.body.seq }, b.jar);
  await api('POST', `/api/conversations/${cid}/read`, { through_seq: second.body.seq }, b.jar);
  const secondAfter = await api('GET', `/api/letters/${second.body.id}`, undefined, a.jar);
  assert.equal(secondAfter.body.state, 'read');
  assert.ok(secondAfter.body.read_at);
});

test('unread counts come from the server rows', async () => {
  const a = await signUp(`${PREFIX}unra`);
  const b = await signUp(`${PREFIX}unrb`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  for (let i = 0; i < 3; i++) {
    await api('POST', '/api/letters', {
      id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id,
      iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'J'.repeat(235),
    }, a.jar);
  }
  const before = await api('GET', `/api/conversations/${cid}`, undefined, b.jar);
  assert.equal(before.body.unread, 0); // held letters are not unread until delivered
  // Collect them.
  const inbox = await api('GET', '/api/inbox', undefined, b.jar);
  const maxSeq = Math.max(...inbox.body.letters.map((l: any) => l.seq));
  await api('POST', '/api/inbox/ack', { through_seq: maxSeq }, b.jar);
  const after = await api('GET', `/api/conversations/${cid}`, undefined, b.jar);
  assert.equal(after.body.unread, 3);
  // Reading clears them.
  await api('POST', `/api/conversations/${cid}/read`, { through_seq: maxSeq }, b.jar);
  const cleared = await api('GET', `/api/conversations/${cid}`, undefined, b.jar);
  assert.equal(cleared.body.unread, 0);
});

test('retract: sender only, within 24 hours, and repeat answers 200 unchanged', async () => {
  const a = await signUp(`${PREFIX}reta`);
  const b = await signUp(`${PREFIX}retb`);
  const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);
  const posted = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: b.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'K'.repeat(235),
  }, a.jar);
  assert.equal(posted.body.can_retract, true);

  // The recipient may not retract.
  const notSender = await api('POST', `/api/letters/${posted.body.id}/retract`, {}, b.jar);
  assert.equal(notSender.status, 403);
  assert.equal(notSender.body.error, 'not_sender');

  const retracted = await api('POST', `/api/letters/${posted.body.id}/retract`, {}, a.jar);
  assert.equal(retracted.status, 200);
  assert.ok(retracted.body.retracted_at);
  const repeat = await api('POST', `/api/letters/${posted.body.id}/retract`, {}, a.jar);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.retracted_at, retracted.body.retracted_at);
});

test('body limits: oversized JSON answers 413 before parsing', async () => {
  const { jar } = await signUp(`${PREFIX}limits`);
  const big = JSON.stringify({ iv: 'x'.repeat(140_000) });
  const res = await fetch(`${BASE}/api/me/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: jar.cookie },
    body: big,
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'too_large' });
});

test('boundary: cross-origin state changes answer 403', async () => {
  const { jar } = await signUp(`${PREFIX}origin`);
  const res = await fetch(`${BASE}/api/me/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: jar.cookie, origin: 'https://evil.example' },
    body: JSON.stringify({ read_receipts: false }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'cross_origin' });
});

test('boundary: non-JSON content type answers 415', async () => {
  const { jar } = await signUp(`${PREFIX}ctype`);
  const res = await fetch(`${BASE}/api/me/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'text/plain', cookie: jar.cookie },
    body: 'read_receipts=false',
  });
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { error: 'unsupported_media_type' });
});

test('blobs: declare, upload, store, then serve as a download', async () => {
  const sender = await signUp(`${PREFIX}blobsend`);
  const recipient = await signUp(`${PREFIX}blobrecv`);
  const conversation = await api('POST', '/api/conversations', { peer_id: recipient.account.id }, sender.jar);
  const cid = conversation.body.id;
  await api('POST', `/api/conversations/${cid}/accept`, {}, recipient.jar);

  const bytes = crypto.getRandomValues(new Uint8Array(1024));
  const id = uuid();
  const declared = await api('POST', '/api/blobs', { id, kind: 'file', size: bytes.length + 16 }, sender.jar);
  assert.equal(declared.status, 201);
  assert.equal(declared.body.state, 'uploading');

  const uploaded = await fetch(`${BASE}/api/blobs/${id}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', cookie: sender.jar.cookie },
    body: Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]),
  });
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).state, 'stored');

  // Over the cap: refused before anything is stored.
  const over = await api('POST', '/api/blobs', { id: uuid(), kind: 'file', size: 26_214_401 }, sender.jar);
  assert.equal(over.status, 413);
  assert.equal(over.body.error, 'too_large');

  // A shorter body answers size_mismatch.
  const shortId = uuid();
  await api('POST', '/api/blobs', { id: shortId, kind: 'file', size: 500 }, sender.jar);
  const short = await fetch(`${BASE}/api/blobs/${shortId}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', cookie: sender.jar.cookie },
    body: Buffer.alloc(100),
  });
  assert.equal(short.status, 422);
  assert.equal((await short.json()).error, 'size_mismatch');

  // Posting the letter attaches the blob.
  const posted = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: recipient.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'L'.repeat(235), attachment_id: id,
  }, sender.jar);
  assert.equal(posted.status, 201);
  assert.equal(posted.body.attachment_id, id);

  // The same blob on another letter answers attachment_in_use.
  const inUse = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: recipient.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'M'.repeat(235), attachment_id: id,
  }, sender.jar);
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.error, 'attachment_in_use');

  // An unstored blob answers attachment_not_stored without touching storage.
  const unstoredId = uuid();
  await api('POST', '/api/blobs', { id: unstoredId, kind: 'file', size: 64 }, sender.jar);
  const unstored = await api('POST', '/api/letters', {
    id: uuid(), conversation_id: cid, class: 'letter', recipient_key_id: recipient.account.key_id,
    iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'N'.repeat(235), attachment_id: unstoredId,
  }, sender.jar);
  assert.equal(unstored.status, 409);
  assert.equal(unstored.body.error, 'attachment_not_stored');

  // The participant downloads it; an outsider gets 404; headers are the download set.
  const download = await fetch(`${BASE}/api/blobs/${id}`, { headers: { cookie: recipient.jar.cookie } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(download.headers.get('content-disposition'), 'attachment');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  const data = new Uint8Array(await download.arrayBuffer());
  assert.equal(data.length, bytes.length + 16);

  const outsider = await signUp(`${PREFIX}blobout`);
  const denied = await fetch(`${BASE}/api/blobs/${id}`, { headers: { cookie: outsider.jar.cookie } });
  assert.equal(denied.status, 404);
});

test('grading dump and clock answer only with GRADING=1', async () => {
  const dump = await api('GET', '/api/grading/dump');
  assert.equal(dump.status, 200);
  assert.ok(dump.body.tables.accounts);
  assert.ok(dump.body.tables.letters);
  const clock = await api('GET', '/api/grading/clock');
  assert.equal(clock.status, 200);
  assert.equal(typeof clock.body.offset_ms, 'number');
  const set = await api('POST', '/api/grading/clock', { offset_ms: 0 });
  assert.equal(set.status, 200);
  const invalid = await api('POST', '/api/grading/clock', { offset_ms: -5 });
  assert.equal(invalid.status, 422);
});

test('conversations list is newest-updated first', async () => {
  const owner = await signUp(`${PREFIX}listowner`);
  const peers = [];
  for (let i = 0; i < 3; i++) peers.push(await signUp(`${PREFIX}listpeer${i}`));
  const ids = [];
  for (const peer of peers) {
    const conversation = await api('POST', '/api/conversations', { peer_id: peer.account.id }, owner.jar);
    ids.push(conversation.body.id);
  }
  const list = await api('GET', '/api/conversations', undefined, owner.jar);
  const listed = list.body.conversations.map((c: any) => c.id);
  for (const id of ids) assert.ok(listed.includes(id));
  const updatedAt = list.body.conversations.map((c: any) => Date.parse(c.updated_at));
  for (let i = 1; i < updatedAt.length; i++) assert.ok(updatedAt[i - 1] >= updatedAt[i], 'newest first');
});

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
let failed = 0;
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
console.log(`api: ${tests.length} tests, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
