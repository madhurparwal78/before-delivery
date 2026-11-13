/** Exercises the published Airfold API end to end with an independent sealing client. */
import { randomUUID } from 'node:crypto';
import {
  b64u,
  conversationKey,
  makeIdentity,
  makeRecoveryCode,
  openLetter,
  recoveryMaterial,
  sealBytes,
  sealLetter,
  sealNumber,
  unb64u,
} from './scheme.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  process.stdout.write(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}\n`);
}

class Client {
  constructor() {
    this.cookie = null;
  }

  async call(method, path, body, options = {}) {
    const headers = {};
    if (this.cookie !== null) headers['cookie'] = this.cookie;
    if (body !== undefined && !options.raw) headers['content-type'] = 'application/json';
    if (options.raw) headers['content-type'] = 'application/octet-stream';
    if (options.origin !== undefined) headers['origin'] = options.origin;
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie();
    for (const value of setCookie) {
      if (value.startsWith('airfold_session=')) this.cookie = value.split(';')[0];
    }
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('application/json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload, headers: response.headers };
  }
}

async function signUp(username) {
  const client = new Client();
  const identity = await makeIdentity();
  const code = makeRecoveryCode();
  const material = await recoveryMaterial(code);
  const backup = await sealBytes(material.backupKey, identity.pkcs8);
  const created = await client.call('POST', '/api/accounts', {
    username,
    public_key: b64u(identity.raw),
    recovery_verifier: b64u(material.verifier),
    key_backup: backup,
  });
  check(`signup ${username}`, created.status === 201, created.body);
  return { client, identity, code, account: created.body };
}

async function main() {
  await (await fetch(`${BASE}/api/grading/clock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offset_ms: 0 }),
  })).json();

  const stamp = Date.now().toString(36);
  const ada = await signUp(`ada.${stamp}`);
  const bob = await signUp(`bob.${stamp}`);

  // Boundary
  const foreign = await ada.client.call('POST', '/api/conversations', { peer_id: bob.account.id }, {
    origin: 'http://evil.example',
  });
  check('cross origin', foreign.status === 403 && foreign.body.error === 'cross_origin', foreign.body);
  const unsupported = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', cookie: ada.client.cookie },
    body: 'x',
  });
  check('unsupported media type', unsupported.status === 415);
  const tooLarge = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ada.client.cookie },
    body: JSON.stringify({ pad: 'x'.repeat(140000) }),
  });
  check('json too large', tooLarge.status === 413);

  // Lookup
  const self = await ada.client.call('GET', `/api/lookup?username=${ada.account.username}`);
  check('lookup self 404', self.status === 404, self.body);
  const prefix = await ada.client.call('GET', `/api/lookup?username=bob`);
  check('lookup prefix 404', prefix.status === 404, prefix.body);
  const found = await ada.client.call(
    'GET',
    `/api/lookup?username=${bob.account.username.toUpperCase()}`,
  );
  check('lookup exact', found.status === 200 && found.body.id === bob.account.id, found.body);
  check('lookup profile null', found.body.profile === null, found.body);

  // Conversation
  const created = await ada.client.call('POST', '/api/conversations', { peer_id: bob.account.id });
  check('conversation created', created.status === 201, created.body);
  const again = await ada.client.call('POST', '/api/conversations', { peer_id: bob.account.id });
  check('conversation idempotent', again.status === 200 && again.body.id === created.body.id);
  const selfConversation = await ada.client.call('POST', '/api/conversations', {
    peer_id: ada.account.id,
  });
  check('conversation self', selfConversation.status === 422 && selfConversation.body.fields.peer_id === 'self');
  const unknown = await ada.client.call('POST', '/api/conversations', { peer_id: randomUUID() });
  check('conversation unknown peer', unknown.status === 404);
  const conversationId = created.body.id;
  check('starter accepted', created.body.status === 'accepted', created.body);

  // Bob cannot see it yet
  const hidden = await bob.client.call('GET', `/api/conversations/${conversationId}`);
  check('request hidden before first letter', hidden.status === 404, hidden.body);

  // Seal a letter with the independent scheme
  const adaKey = await conversationKey(
    ada.identity.pair.privateKey,
    unb64u(bob.account.public_key),
    ada.account.id,
    bob.account.id,
  );
  const sealed = await sealLetter(adaKey, { v: 1, kind: 'text', text: 'Hello from Lisbon' });
  check('worked example ciphertext length', sealed.ciphertext.length === 235, sealed.ciphertext.length);
  check('worked example iv length', sealed.iv.length === 16, sealed.iv.length);

  const letterId = randomUUID();
  const posted = await ada.client.call('POST', '/api/letters', {
    id: letterId,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...sealed,
  });
  check('letter posted', posted.status === 201 && posted.body.state === 'sent', posted.body);
  check('sender gets no ciphertext', posted.body.ciphertext === null, posted.body);

  const replay = await ada.client.call('POST', '/api/letters', {
    id: letterId,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...sealed,
  });
  check('letter replay', replay.status === 200 && replay.body.id === letterId, replay.body);

  const conflict = await ada.client.call('POST', '/api/letters', {
    id: letterId,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...(await sealLetter(adaKey, { v: 1, kind: 'text', text: 'Different' })),
  });
  check('letter id conflict', conflict.status === 409 && conflict.body.error === 'letter_id_conflict', conflict.body);

  // Bob collects
  const requests = await bob.client.call('GET', '/api/conversations?status=request');
  check('request listed', requests.body.conversations.length === 1, requests.body);
  check('request status', requests.body.conversations[0].status === 'request');
  check('request peer profile null', requests.body.conversations[0].peer.profile === null);
  check('request unread zero before ack', requests.body.conversations[0].unread === 0);

  const inbox = await bob.client.call('GET', '/api/inbox');
  check('inbox holds one', inbox.body.letters.length === 1, inbox.body);
  const held = inbox.body.letters[0];
  const bobKey = await conversationKey(
    bob.identity.pair.privateKey,
    unb64u(ada.account.public_key),
    bob.account.id,
    ada.account.id,
  );
  const opened = await openLetter(bobKey, held.iv, held.ciphertext);
  check('letter opens', opened.text === 'Hello from Lisbon', opened);

  const acked = await bob.client.call('POST', '/api/inbox/ack', { through_seq: held.seq });
  check('ack delivers one', acked.body.delivered === 1, acked.body);
  const ackedAgain = await bob.client.call('POST', '/api/inbox/ack', { through_seq: held.seq });
  check('ack twice delivers none', ackedAgain.body.delivered === 0, ackedAgain.body);

  const afterAck = await ada.client.call('GET', `/api/letters/${letterId}`);
  check('letter delivered', afterAck.body.state === 'delivered', afterAck.body);
  check('held copy deleted', afterAck.body.ciphertext === null);
  const inboxEmpty = await bob.client.call('GET', '/api/inbox');
  check('inbox empty after ack', inboxEmpty.body.letters.length === 0, inboxEmpty.body);

  const unreadRequest = await bob.client.call('GET', '/api/conversations?status=request');
  check('request unread one', unreadRequest.body.conversations[0].unread === 1, unreadRequest.body);

  // Request rules
  const blockedPost = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: ada.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'nope' })),
  });
  check('request cannot post', blockedPost.status === 409 && blockedPost.body.error === 'request_not_accepted', blockedPost.body);

  const readWhileRequest = await bob.client.call('POST', `/api/conversations/${conversationId}/read`, {
    through_seq: held.seq,
  });
  check('read while request ok', readWhileRequest.status === 200);
  const stillDelivered = await ada.client.call('GET', `/api/letters/${letterId}`);
  check('no receipt while request', stillDelivered.body.state === 'delivered', stillDelivered.body);
  check('read clears unread', readWhileRequest.body.unread === 0, readWhileRequest.body);

  const accepted = await bob.client.call('POST', `/api/conversations/${conversationId}/accept`, {});
  check('accept', accepted.status === 200 && accepted.body.status === 'accepted', accepted.body);
  const acceptAgain = await bob.client.call('POST', `/api/conversations/${conversationId}/accept`, {});
  check('accept twice', acceptAgain.status === 409 && acceptAgain.body.error === 'not_a_request', acceptAgain.body);
  const deleteAccepted = await bob.client.call('DELETE', `/api/conversations/${conversationId}`);
  check('delete accepted refused', deleteAccepted.status === 409, deleteAccepted.body);

  // Profiles become visible after both accept
  const profileBody = new TextEncoder().encode(
    JSON.stringify({ v: 1, display_name: 'Ada Lovell', photo: null }),
  );
  const profileKey = crypto.getRandomValues(new Uint8Array(32));
  const padded = (await import('./scheme.mjs')).pad(profileBody);
  const sealedProfile = await sealBytes(profileKey, padded);
  const savedProfile = await ada.client.call('PUT', '/api/me/profile', {
    ...sealedProfile,
    photo_blob_id: null,
  });
  check('profile saved', savedProfile.status === 200 && savedProfile.body.profile !== null, savedProfile.body);
  const peerView = await bob.client.call('GET', `/api/conversations/${conversationId}`);
  check('peer profile visible after accept', peerView.body.peer.profile !== null, peerView.body.peer);

  // Reciprocal read receipts
  const reply = randomUUID();
  const replyPost = await bob.client.call('POST', '/api/letters', {
    id: reply,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: ada.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'Reply' })),
  });
  check('reply posted', replyPost.status === 201, replyPost.body);
  const adaInbox = await ada.client.call('GET', '/api/inbox');
  check('ada holds reply', adaInbox.body.letters.length === 1, adaInbox.body);
  await ada.client.call('POST', '/api/inbox/ack', { through_seq: adaInbox.body.letters[0].seq });
  await ada.client.call('POST', `/api/conversations/${conversationId}/read`, {
    through_seq: adaInbox.body.letters[0].seq,
  });
  const readLetter = await bob.client.call('GET', `/api/letters/${reply}`);
  check('reciprocal read', readLetter.body.state === 'read', readLetter.body);

  await ada.client.call('PATCH', '/api/me/settings', { read_receipts: false });
  const third = randomUUID();
  await bob.client.call('POST', '/api/letters', {
    id: third,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: ada.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'No receipt' })),
  });
  const thirdInbox = await ada.client.call('GET', '/api/inbox');
  await ada.client.call('POST', '/api/inbox/ack', { through_seq: thirdInbox.body.letters[0].seq });
  await ada.client.call('POST', `/api/conversations/${conversationId}/read`, {
    through_seq: thirdInbox.body.letters[0].seq,
  });
  const noReceipt = await bob.client.call('GET', `/api/letters/${third}`);
  check('receipts off keeps delivered', noReceipt.body.state === 'delivered', noReceipt.body);
  await ada.client.call('PATCH', '/api/me/settings', { read_receipts: true });
  const stillDeliveredAfter = await bob.client.call('GET', `/api/letters/${third}`);
  check('read stays delivered for good', stillDeliveredAfter.body.state === 'delivered');

  // Seal numbers
  const expected = await sealNumber(unb64u(ada.account.public_key), unb64u(bob.account.public_key));
  check('seal number shape', /^(\d{5} ){11}\d{5}$/.test(expected), expected);
  const stale = await ada.client.call('PUT', `/api/contacts/${bob.account.id}/seal`, {
    key_id: 'not-a-key',
    verified: true,
  });
  check('stale key', stale.status === 409 && stale.body.error === 'stale_key', stale.body);
  const verified = await ada.client.call('PUT', `/api/contacts/${bob.account.id}/seal`, {
    key_id: bob.account.key_id,
    verified: true,
  });
  check('verified', verified.body.seal === 'verified', verified.body);

  // Attachments
  const fileBytes = crypto.getRandomValues(new Uint8Array(1024));
  const attachmentKey = crypto.getRandomValues(new Uint8Array(32));
  const sealedFile = await sealBytes(attachmentKey, fileBytes);
  const sealedFileBytes = unb64u(sealedFile.ciphertext);
  const blobId = randomUUID();
  const declared = await ada.client.call('POST', '/api/blobs', {
    id: blobId,
    kind: 'file',
    size: sealedFileBytes.length,
  });
  check('blob declared', declared.status === 201 && declared.body.state === 'uploading', declared.body);
  const declaredReplay = await ada.client.call('POST', '/api/blobs', {
    id: blobId,
    kind: 'file',
    size: sealedFileBytes.length,
  });
  check('blob replay', declaredReplay.status === 200, declaredReplay.body);
  const blobConflict = await ada.client.call('POST', '/api/blobs', {
    id: blobId,
    kind: 'file',
    size: 10,
  });
  check('blob id conflict', blobConflict.status === 409 && blobConflict.body.error === 'blob_id_conflict');
  const overCap = await ada.client.call('POST', '/api/blobs', {
    id: randomUUID(),
    kind: 'file',
    size: 26214401,
  });
  check('blob too large', overCap.status === 413 && overCap.body.error === 'too_large', overCap.body);

  const letterBeforeUpload = await ada.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    attachment_id: blobId,
    ...(await sealLetter(adaKey, { v: 1, kind: 'file', text: '', attachment: { blob_id: blobId } })),
  });
  check(
    'attachment not stored',
    letterBeforeUpload.status === 409 && letterBeforeUpload.body.error === 'attachment_not_stored',
    letterBeforeUpload.body,
  );

  const shortUpload = await ada.client.call(
    'PUT',
    `/api/blobs/${blobId}/content`,
    Buffer.from(sealedFileBytes.subarray(0, 10)),
    { raw: true },
  );
  check('short upload', shortUpload.status === 422 && shortUpload.body.error === 'size_mismatch', shortUpload.body);
  const longUpload = await ada.client.call(
    'PUT',
    `/api/blobs/${blobId}/content`,
    Buffer.concat([Buffer.from(sealedFileBytes), Buffer.alloc(5)]),
    { raw: true },
  );
  check('long upload', longUpload.status === 413, longUpload.body);
  const uploaded = await ada.client.call('PUT', `/api/blobs/${blobId}/content`, Buffer.from(sealedFileBytes), {
    raw: true,
  });
  check('uploaded', uploaded.status === 200 && uploaded.body.state === 'stored', uploaded.body);
  const uploadedAgain = await ada.client.call('PUT', `/api/blobs/${blobId}/content`, Buffer.from(sealedFileBytes), {
    raw: true,
  });
  check('already stored', uploadedAgain.status === 409 && uploadedAgain.body.error === 'already_stored');

  const fileLetterId = randomUUID();
  const fileLetter = await ada.client.call('POST', '/api/letters', {
    id: fileLetterId,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    attachment_id: blobId,
    ...(await sealLetter(adaKey, {
      v: 1,
      kind: 'file',
      text: '',
      attachment: { blob_id: blobId, name: 'ferry-timetable.pdf' },
    })),
  });
  check('file letter posted', fileLetter.status === 201, fileLetter.body);
  const reuse = await ada.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    attachment_id: blobId,
    ...(await sealLetter(adaKey, { v: 1, kind: 'file', text: '', attachment: { blob_id: blobId } })),
  });
  check('attachment in use', reuse.status === 409 && reuse.body.error === 'attachment_in_use', reuse.body);

  const download = await bob.client.call('GET', `/api/blobs/${blobId}`);
  check('download by participant', download.status === 200 && download.body.length === sealedFileBytes.length);
  check('download headers', download.headers.get('content-disposition') === 'attachment');
  check('download type', download.headers.get('content-type') === 'application/octet-stream');
  const carol = await signUp(`carol.${stamp}`);
  const stranger = await carol.client.call('GET', `/api/blobs/${blobId}`);
  check('stranger blob 404', stranger.status === 404, stranger.body);
  const strangerConversation = await carol.client.call('GET', `/api/conversations/${conversationId}`);
  check('stranger conversation 404', strangerConversation.status === 404);
  const strangerLetter = await carol.client.call('GET', `/api/letters/${letterId}`);
  check('stranger letter 404', strangerLetter.status === 404);
  const strangerPost = await carol.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...sealed,
  });
  check('stranger post 404', strangerPost.status === 404, strangerPost.body);

  // Retract
  const retract = await ada.client.call('POST', `/api/letters/${fileLetterId}/retract`, {});
  check('retract', retract.status === 200 && retract.body.retracted_at !== null, retract.body);
  const retractRepeat = await ada.client.call('POST', `/api/letters/${fileLetterId}/retract`, {});
  check('retract repeat', retractRepeat.status === 200);
  const notSender = await bob.client.call('POST', `/api/letters/${letterId}/retract`, {});
  check('retract not sender', notSender.status === 403 && notSender.body.error === 'not_sender', notSender.body);
  const goneAttachment = await bob.client.call('GET', `/api/blobs/${blobId}`);
  check('retract deletes attachment object', goneAttachment.status === 404, goneAttachment.status);

  // Retract window closes with the server clock
  const clock = await ada.client.call('POST', '/api/grading/clock', { offset_ms: 25 * 3600 * 1000 });
  check('clock offset', clock.body.offset_ms === 25 * 3600 * 1000, clock.body);
  const windowClosed = await ada.client.call('POST', `/api/letters/${letterId}/retract`, {});
  check('retract window closed', windowClosed.status === 409 && windowClosed.body.error === 'retract_window_closed', windowClosed.body);
  const canRetract = await ada.client.call('GET', `/api/letters/${letterId}`);
  check('can_retract false', canRetract.body.can_retract === false);

  // Returns after 30 days
  const strayId = randomUUID();
  await ada.client.call('POST', '/api/letters', {
    id: strayId,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...(await sealLetter(adaKey, { v: 1, kind: 'text', text: 'Stray' })),
  });
  await ada.client.call('POST', '/api/grading/clock', {
    offset_ms: 25 * 3600 * 1000 + 31 * 24 * 3600 * 1000,
  });
  const returned = await ada.client.call('GET', `/api/letters/${strayId}`);
  check('returned', returned.body.state === 'failed' && returned.body.failure === 'returned', returned.body);
  const bobInboxAfterReturn = await bob.client.call('GET', '/api/inbox');
  check('returned not held', bobInboxAfterReturn.body.letters.every((l) => l.id !== strayId));
  await ada.client.call('POST', '/api/grading/clock', { offset_ms: 0 });

  // Blocking
  const blocked = await bob.client.call('PUT', `/api/blocks/${ada.account.id}`, {});
  check('block', blocked.status === 200 && blocked.body.username === ada.account.username, blocked.body);
  const blockedList = await bob.client.call('GET', '/api/blocks');
  check('block listed', blockedList.body.blocks.length === 1, blockedList.body);
  const whileBlocked = randomUUID();
  const droppedPost = await ada.client.call('POST', '/api/letters', {
    id: whileBlocked,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...(await sealLetter(adaKey, { v: 1, kind: 'text', text: 'While blocked' })),
  });
  check('blocked post accepted as sent', droppedPost.status === 201 && droppedPost.body.state === 'sent', droppedPost.body);
  const blockedInbox = await bob.client.call('GET', '/api/inbox');
  check('blocked letter never queued', blockedInbox.body.letters.every((l) => l.id !== whileBlocked), blockedInbox.body);
  const bobBlockedPost = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: ada.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'blocker' })),
  });
  check('blocker cannot post', bobBlockedPost.status === 409 && bobBlockedPost.body.error === 'contact_blocked', bobBlockedPost.body);
  await bob.client.call('DELETE', `/api/blocks/${ada.account.id}`);
  const afterUnblock = randomUUID();
  await ada.client.call('POST', '/api/letters', {
    id: afterUnblock,
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: bob.account.key_id,
    ...(await sealLetter(adaKey, { v: 1, kind: 'text', text: 'After unblock' })),
  });
  const unblockedInbox = await bob.client.call('GET', '/api/inbox');
  check('letters flow after unblock', unblockedInbox.body.letters.some((l) => l.id === afterUnblock), unblockedInbox.body);
  check('blocked letter still withheld', unblockedInbox.body.letters.every((l) => l.id !== whileBlocked));

  // Mute
  const muted = await bob.client.call('PUT', `/api/conversations/${conversationId}/mute`, {
    duration: '1h',
  });
  check('muted', muted.body.muted_until !== null, muted.body);
  const unmuted = await bob.client.call('PUT', `/api/conversations/${conversationId}/mute`, {
    duration: 'off',
  });
  check('unmuted', unmuted.body.muted_until === null, unmuted.body);

  // Username change and holds
  const taken = await ada.client.call('PATCH', '/api/me/username', { username: bob.account.username });
  check('username taken', taken.status === 409 && taken.body.error === 'username_taken', taken.body);
  const same = await ada.client.call('PATCH', '/api/me/username', { username: ada.account.username });
  check('username same', same.status === 422 && same.body.fields.username === 'same', same.body);
  const oldName = ada.account.username;
  const renamed = await ada.client.call('PATCH', '/api/me/username', { username: `ada2.${stamp}` });
  check('username changed', renamed.status === 200 && renamed.body.username === `ada2.${stamp}`, renamed.body);
  const heldName = await ada.client.call('GET', `/api/usernames/${oldName}/availability`);
  check('released name held', heldName.body.available === false && heldName.body.reason === 'taken', heldName.body);
  const lookupHeld = await bob.client.call('GET', `/api/lookup?username=${oldName}`);
  check('held name lookup 404', lookupHeld.status === 404);
  const cooldown = await ada.client.call('PATCH', '/api/me/username', { username: `ada3.${stamp}` });
  check('username cooldown', cooldown.status === 409 && cooldown.body.error === 'username_cooldown' && typeof cooldown.body.retry_at === 'string', cooldown.body);
  await ada.client.call('POST', '/api/grading/clock', { offset_ms: 8 * 24 * 3600 * 1000 });
  const afterCooldown = await ada.client.call('PATCH', '/api/me/username', { username: `ada3.${stamp}` });
  check('username changed after cooldown', afterCooldown.status === 200, afterCooldown.body);
  await ada.client.call('POST', '/api/grading/clock', { offset_ms: 0 });

  // Recovery in a new browser
  const restored = new Client();
  const freshIdentity = await makeIdentity();
  const material = await recoveryMaterial(ada.code);
  const freshBackup = await sealBytes(material.backupKey, freshIdentity.pkcs8);
  const wrong = await restored.call('POST', '/api/recover', {
    username: `ada3.${stamp}`,
    recovery_verifier: b64u(crypto.getRandomValues(new Uint8Array(32))),
    public_key: b64u(freshIdentity.raw),
    key_backup: freshBackup,
  });
  check('recover wrong verifier', wrong.status === 401 && wrong.body.error === 'recovery_failed', wrong.body);
  const recovered = await restored.call('POST', '/api/recover', {
    username: `ada3.${stamp}`,
    recovery_verifier: b64u(material.verifier),
    public_key: b64u(freshIdentity.raw),
    key_backup: freshBackup,
  });
  check('recovered', recovered.status === 200 && recovered.body.account.key_id === freshIdentity.keyId, recovered.body);
  check('earlier key backups returned', recovered.body.key_backups.length >= 1, recovered.body.key_backups);
  const oldSession = await ada.client.call('GET', '/api/me');
  check('old session revoked', oldSession.status === 401, oldSession.status);

  const keys = await bob.client.call('GET', `/api/accounts/${ada.account.id}/keys`);
  check('key history', keys.body.keys.length >= 2 && keys.body.keys.at(-1).current === true, keys.body);

  const changedView = await bob.client.call('GET', `/api/conversations/${conversationId}`);
  check('seal changed', changedView.body.peer.seal === 'changed', changedView.body.peer);
  const pausedPost = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recovered.body.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'paused' })),
  });
  check('letters paused on key change', pausedPost.status === 409 && pausedPost.body.error === 'seal_change_unaccepted', pausedPost.body);
  await bob.client.call('PUT', `/api/contacts/${ada.account.id}/seal`, {
    key_id: recovered.body.account.key_id,
    verified: false,
  });
  const newKey = await conversationKey(
    bob.identity.pair.privateKey,
    freshIdentity.raw,
    bob.account.id,
    ada.account.id,
  );
  const afterAccept = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recovered.body.account.key_id,
    ...(await sealLetter(newKey, { v: 1, kind: 'text', text: 'resealed' })),
  });
  check('letters flow after accepting seal', afterAccept.status === 201, afterAccept.body);
  const staleKeyPost = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: ada.account.key_id,
    ...(await sealLetter(bobKey, { v: 1, kind: 'text', text: 'stale' })),
  });
  check('recipient key changed', staleKeyPost.status === 409 && staleKeyPost.body.error === 'recipient_key_changed' && staleKeyPost.body.key_id === recovered.body.account.key_id, staleKeyPost.body);

  // The restored browser can still open what was held for the earlier key
  const restoredInbox = await restored.call('GET', '/api/inbox');
  check('restored collects held letters', restoredInbox.body.letters.length >= 1, restoredInbox.body);

  // Rate limiting
  let limited = null;
  for (let i = 0; i < 7; i += 1) {
    limited = await restored.call('POST', '/api/recover', {
      username: `bogus.${stamp}`,
      recovery_verifier: b64u(crypto.getRandomValues(new Uint8Array(32))),
      public_key: b64u(freshIdentity.raw),
      key_backup: freshBackup,
    });
  }
  check('recover rate limited', limited.status === 429 && limited.body.error === 'too_many_attempts', limited.body);

  // Validation
  const badIv = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recovered.body.account.key_id,
    iv: 'short',
    ciphertext: sealed.ciphertext,
  });
  check('bad iv', badIv.status === 422 && badIv.body.fields.iv === 'invalid', badIv.body);
  const badCiphertext = await bob.client.call('POST', '/api/letters', {
    id: randomUUID(),
    conversation_id: conversationId,
    class: 'letter',
    recipient_key_id: recovered.body.account.key_id,
    iv: sealed.iv,
    ciphertext: b64u(new Uint8Array(100)),
  });
  check('bad ciphertext', badCiphertext.status === 422 && badCiphertext.body.fields.ciphertext === 'invalid', badCiphertext.body);

  // Validation on the conversation routes
  const badMute = await bob.client.call('PUT', `/api/conversations/${conversationId}/mute`, {
    duration: 'forever',
  });
  check('bad mute duration', badMute.status === 422, badMute.body);
  const badRead = await bob.client.call('POST', `/api/conversations/${conversationId}/read`, {
    through_seq: 'soon',
  });
  check('bad read marker', badRead.status === 422, badRead.body);
  const badLimit = await bob.client.call(
    'GET',
    `/api/conversations/${conversationId}/letters?limit=500`,
  );
  check('bad letters limit', badLimit.status === 422, badLimit.body);
  const listed = await bob.client.call(
    'GET',
    `/api/conversations/${conversationId}/letters?limit=200`,
  );
  const seqs = listed.body.letters.map((letter) => letter.seq);
  check(
    'letters come back in ascending seq',
    seqs.every((value, index) => index === 0 || value > seqs[index - 1]),
    seqs.join(','),
  );

  // Control letters are queued like letters but never count as unread
  const pending = await restored.call('GET', '/api/inbox');
  if (pending.body.letters.length > 0) {
    await restored.call('POST', '/api/inbox/ack', {
      through_seq: Math.max(...pending.body.letters.map((letter) => letter.seq)),
    });
  }
  const beforeControl = await restored.call('GET', `/api/conversations/${conversationId}`);
  const controlId = randomUUID();
  const control = await bob.client.call('POST', '/api/letters', {
    id: controlId,
    conversation_id: conversationId,
    class: 'control',
    recipient_key_id: recovered.body.account.key_id,
    ...(await sealLetter(newKey, {
      v: 1,
      kind: 'profile',
      profile_key: b64u(crypto.getRandomValues(new Uint8Array(32))),
    })),
  });
  check('control letter posted', control.status === 201, control.body);
  const controlInbox = await restored.call('GET', '/api/inbox');
  check(
    'control letters are queued',
    controlInbox.body.letters.some((letter) => letter.id === controlId),
  );
  await restored.call('POST', '/api/inbox/ack', {
    through_seq: Math.max(...controlInbox.body.letters.map((letter) => letter.seq)),
  });
  const withControl = await restored.call('GET', `/api/conversations/${conversationId}`);
  const controlLetter = await restored.call('GET', `/api/letters/${controlId}`);
  check('control letter delivered', controlLetter.body.state === 'delivered', controlLetter.body);
  check(
    'control letters never count as unread',
    withControl.body.unread === beforeControl.body.unread,
    `${beforeControl.body.unread} -> ${withControl.body.unread}`,
  );

  const dump = await ada.client.call('GET', '/api/grading/dump');
  check('dump tables', typeof dump.body.tables === 'object' && Array.isArray(dump.body.tables.letters), Object.keys(dump.body.tables ?? {}));
  const letterRows = dump.body.tables.letters;
  check(
    'no plaintext in letters table',
    letterRows.every((row) => row.ciphertext === null || /^[A-Za-z0-9_-]+$/.test(row.ciphertext)),
  );

  process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`smoke run failed: ${error.stack}\n`);
  process.exit(1);
});
