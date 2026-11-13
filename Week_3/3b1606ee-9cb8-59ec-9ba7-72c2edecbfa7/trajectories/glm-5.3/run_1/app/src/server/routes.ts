import express, { type Request, type RequestHandler, type Response } from 'express';
import { createHash } from 'node:crypto';
import { b64urlDecode } from '../shared/b64.js';
import { CT_MAX, CT_MULTIPLE, GCM_TAG_BYTES, IV_BYTES, KEY_BYTES } from '../shared/sealing-spec.js';
import type { AppConfig, BlobRecord, Conversation, Letter, SealedProfile } from '../shared/types.js';
import { config } from './config.js';
import { usernameShape } from '../shared/username.js';
import { clockOffset, now, nowIso, setClockOffset } from './clock.js';
import { errorBody } from './errors.js';
import { Hub, readSessionCookie } from './hub.js';
import {
  accountById,
  accountByUsername,
  accountForSession,
  availability,
  changeUsername,
  createAccount,
  isValidP256Point,
  keyHistory,
  recoverAccount,
  RecoveryFailedError,
  SameUsernameError,
  sharesAcceptedConversation,
  TooManyAttemptsError,
  updateProfile,
  updateSettings,
  UsernameCooldownError,
  UsernameInvalidError,
  UsernameTakenError,
  type AccountRecord,
} from './accounts.js';
import {
  acceptConversation,
  blockAccount,
  blocksOf,
  conversationById,
  conversationsForSides,
  currentKeyOf,
  deleteRequestFor,
  findOrCreateConversation,
  inboxFor,
  isBlocked,
  lastLetterForSides,
  letterById,
  lettersOfConversation,
  markRead,
  sealStatusOf,
  setMute,
  setSeal,
  sideOf,
  unblockAccount,
  unreadCount,
  type ConversationRecord,
  type LetterRecord,
} from './conversations.js';
import { postLetter, LetterConflictError } from './posting.js';
import { deleteObject, getSealedBytes, headObject, probe, putSealedBytes } from './object-storage.js';
import { iso, retractWindowOpen, serializeAccount, serializeBlob, serializeConversation, serializeLetter } from './serialize.js';
import { newId, nextSeq } from './store.js';
import { withTransaction, txQuery, query } from './db.js';

export const hub = new Hub();
const router = express.Router();

// --- session helpers ---

const SESSION_COOKIE = 'airfold_session';

function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function sessionTokenOf(req: Request): string | null {
  return readSessionCookie(req.headers.cookie ?? '');
}

async function requireAccount(req: Request, res: Response): Promise<AccountRecord | null> {
  const token = sessionTokenOf(req);
  if (!token) {
    res.status(401).json(errorBody('unauthenticated'));
    return null;
  }
  const account = await accountForSession(token);
  if (!account) {
    res.status(401).json(errorBody('unauthenticated'));
    return null;
  }
  return account;
}

// --- boundary (DP-39) ---

const JSON_LIMIT = 131_072;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const isBlobContentRoute = (req: Request): boolean =>
  req.method === 'PUT' && /^\/blobs\/[^/]+\/content$/.test(req.path);

router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const origin = req.headers.origin;
  if (origin && STATE_CHANGING.has(req.method) && !sameOrigin(origin, req.headers.host)) {
    res.status(403).json(errorBody('cross_origin'));
    return;
  }
  if (isBlobContentRoute(req)) {
    next();
    return;
  }
  if (STATE_CHANGING.has(req.method) && (req.headers['content-length'] ?? '0') !== '0') {
    const type = req.headers['content-type'] ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
      res.status(415).json(errorBody('unsupported_media_type'));
      return;
    }
  }
  const length = Number(req.headers['content-length'] ?? '0');
  if (STATE_CHANGING.has(req.method) && length > JSON_LIMIT) {
    res.status(413).json(errorBody('too_large'));
    return;
  }
  if (isBlobContentRoute(req)) {
    next();
    return;
  }
  if (STATE_CHANGING.has(req.method)) {
    express.json({ limit: JSON_LIMIT, strict: true, type: () => true })(req, res, (err) => {
      if (err) {
        const status = (err as { status?: number }).status ?? 400;
        if (status === 413) {
          res.status(413).json(errorBody('too_large'));
          return;
        }
        res.status(status === 400 || status === 415 ? 422 : status).json(errorBody('invalid'));
        return;
      }
      next();
    });
    return;
  }
  next();
});

// --- health, config, availability ---

router.get('/health', async (_req, res) => {
  const ok = await probe();
  res.status(200).json(ok ? { status: 'ok' } : { status: 'unavailable' });
});

router.get('/config', (_req, res) => {
  const body: AppConfig = {
    attachment_max_bytes: config.attachmentMaxBytes,
    timers: config.timers,
    grading: config.grading,
  };
  res.status(200).json(body);
});

router.get('/usernames/:username/availability', async (req, res) => {
  const result = await availability(req.params.username);
  res.status(200).json(result);
});

// --- accounts ---

router.post('/accounts', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const username = typeof body.username === 'string' ? body.username : '';
  const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
  const verifier = typeof body.recovery_verifier === 'string' ? body.recovery_verifier : '';
  const backup = body.key_backup as { iv?: unknown; ciphertext?: unknown } | undefined;
  const shape = usernameShape(username);
  if (shape.reason) fields.username = shape.reason;
  if (!publicKey || !isValidP256Point(publicKey)) fields.public_key = 'invalid';
  if (!verifier || b64urlDecode(verifier).length !== KEY_BYTES) fields.recovery_verifier = 'invalid';
  if (!backup || typeof backup.iv !== 'string' || typeof backup.ciphertext !== 'string') {
    fields.key_backup = 'invalid';
  } else if (b64urlDecode(backup.iv).length !== IV_BYTES || backup.ciphertext.length === 0) {
    fields.key_backup = 'invalid';
  }
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  try {
    const result = await createAccount(
      { username, public_key: publicKey, recovery_verifier: verifier, key_backup: { iv: backup!.iv as string, ciphertext: backup!.ciphertext as string } },
    );
    setSessionCookie(res, result.sessionToken);
    res.status(201).json(serializeAccount(result.account));
  } catch (error) {
    if (error instanceof UsernameTakenError) {
      res.status(409).json(errorBody('username_taken'));
      return;
    }
    if (error instanceof UsernameInvalidError) {
      res.status(422).json({ ...errorBody('invalid'), fields: { username: error.reason } });
      return;
    }
    throw error;
  }
});

router.get('/me', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  res.status(200).json(serializeAccount(account));
});

router.put('/me/profile', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  const iv = typeof body.iv === 'string' ? body.iv : null;
  const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : null;
  const photoBlobIdRaw = body.photo_blob_id;
  const photoBlobId = photoBlobIdRaw === null || photoBlobIdRaw === undefined ? null : typeof photoBlobIdRaw === 'string' ? photoBlobIdRaw : undefined;
  const fields: Record<string, string> = {};
  if (!iv || b64urlDecode(iv).length !== IV_BYTES) fields.iv = 'invalid';
  if (!ciphertext || b64urlDecode(ciphertext).length === 0) fields.ciphertext = 'invalid';
  if (photoBlobId === undefined) fields.photo_blob_id = 'invalid';
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  const photoId: string | null = photoBlobId ?? null;
  if (!iv || !ciphertext) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  const ctBytes = ciphertext ? b64urlDecode(ciphertext) : new Uint8Array(0);
  if (ctBytes.length % CT_MULTIPLE !== GCM_TAG_BYTES || ctBytes.length > CT_MAX) {
    res.status(422).json({ ...errorBody('invalid'), fields: { ciphertext: 'invalid' } });
    return;
  }
  if (photoId !== null) {
    const blob = await blobById(photoId);
    if (!blob || blob.owner_id !== account.id) {
      res.status(404).json(errorBody('not_found'));
      return;
    }
    if (blob.state !== 'stored') {
      res.status(409).json(errorBody('attachment_not_stored'));
      return;
    }
    if (!(await probe())) {
      res.status(503).json(errorBody('storage_unavailable'));
      return;
    }
    const storedSize = await headObject(account.id, photoId);
    if (storedSize !== blob.size) {
      res.status(409).json(errorBody('attachment_not_stored'));
      return;
    }
  }
  await updateProfile(account.id, { iv, ciphertext, photo_blob_id: photoId });
  const fresh = await accountById(account.id);
  res.status(200).json(serializeAccount(fresh!));
});

router.patch('/me/settings', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  const patch: { read_receipts?: boolean; preview?: 'name_and_letter' | 'name_only' | 'none' } = {};
  if (body.read_receipts !== undefined) {
    if (typeof body.read_receipts !== 'boolean') {
      res.status(422).json(errorBody('invalid'));
      return;
    }
    patch.read_receipts = body.read_receipts;
  }
  if (body.preview !== undefined) {
    if (body.preview !== 'name_and_letter' && body.preview !== 'name_only' && body.preview !== 'none') {
      res.status(422).json(errorBody('invalid'));
      return;
    }
    patch.preview = body.preview;
  }
  const fresh = await updateSettings(account.id, patch);
  res.status(200).json(serializeAccount(fresh));
});

router.patch('/me/username', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  if (typeof body.username !== 'string') {
    res.status(422).json({ ...errorBody('invalid'), fields: { username: 'invalid' } });
    return;
  }
  try {
    const fresh = await changeUsername(account, body.username);
    res.status(200).json(serializeAccount(fresh));
  } catch (error) {
    if (error instanceof UsernameCooldownError) {
      res.status(409).json({ ...errorBody('username_cooldown'), retry_at: iso(error.retryAt) });
      return;
    }
    if (error instanceof UsernameTakenError) {
      res.status(409).json(errorBody('username_taken'));
      return;
    }
    if (error instanceof SameUsernameError) {
      res.status(422).json({ ...errorBody('invalid'), fields: { username: 'same' } });
      return;
    }
    if (error instanceof UsernameInvalidError) {
      res.status(422).json({ ...errorBody('invalid'), fields: { username: error.reason } });
      return;
    }
    throw error;
  }
});

router.post('/recover', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const username = typeof body.username === 'string' ? body.username : '';
  const verifier = typeof body.recovery_verifier === 'string' ? body.recovery_verifier : '';
  const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
  const backup = body.key_backup as { iv?: unknown; ciphertext?: unknown } | undefined;
  if (!username) fields.username = 'invalid';
  if (!verifier || b64urlDecode(verifier).length !== KEY_BYTES) fields.recovery_verifier = 'invalid';
  if (!publicKey || !isValidP256Point(publicKey)) fields.public_key = 'invalid';
  if (!backup || typeof backup.iv !== 'string' || typeof backup.ciphertext !== 'string') fields.key_backup = 'invalid';
  else if (b64urlDecode(backup.iv).length !== IV_BYTES || backup.ciphertext.length === 0) fields.key_backup = 'invalid';
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  try {
    const result = await recoverAccount(
      { username, recovery_verifier: verifier, public_key: publicKey, key_backup: { iv: backup!.iv as string, ciphertext: backup!.ciphertext as string } },
    );
    hub.send(result.account.id, { type: 'signed_out' });
    // Tell this account's correspondents that the current key changed.
    const peers = await query<{ account_id: string }>(`
      SELECT DISTINCT CASE WHEN c.starter_id = $1 THEN c.recipient_id ELSE c.starter_id END AS account_id
      FROM conversations c WHERE c.starter_id = $1 OR c.recipient_id = $1`, [result.account.id]);
    for (const peer of peers) {
      hub.send(peer.account_id, { type: 'keys', account_id: result.account.id });
    }
    setSessionCookie(res, result.sessionToken);
    res.status(200).json({
      account: serializeAccount(result.account),
      key_backups: result.key_backups.map((b) => ({ key_id: b.key_id, iv: b.iv, ciphertext: b.ciphertext, created_at: iso(b.created_at) })),
    });
  } catch (error) {
    if (error instanceof RecoveryFailedError) {
      res.status(401).json(errorBody('recovery_failed'));
      return;
    }
    if (error instanceof TooManyAttemptsError) {
      res.status(429).json(errorBody('too_many_attempts'));
      return;
    }
    throw error;
  }
});

// --- lookup, keys, conversations ---

router.get('/lookup', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const username = String(req.query.username ?? '').toLowerCase();
  const target = await accountByUsername(username);
  if (!target || target.id === account.id) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const shared = await sharesAcceptedConversation(account.id, target.id);
  res.status(200).json({
    id: target.id,
    username: target.username,
    key_id: target.key_id,
    public_key: target.public_key,
    profile: shared ? (target.profile_iv && target.profile_ciphertext ? { iv: target.profile_iv, ciphertext: target.profile_ciphertext, photo_blob_id: target.profile_photo_blob_id } : null) : null,
  });
});

router.get('/accounts/:id/keys', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const target = await accountById(req.params.id);
  if (!target) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const keys = await keyHistory(target.id);
  res.status(200).json({
    keys: keys.map((k) => ({ key_id: k.key_id, public_key: k.public_key, created_at: iso(k.created_at), current: k.key_id === target.key_id })),
  });
});

router.post('/conversations', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  const peerId = typeof body.peer_id === 'string' ? body.peer_id : null;
  if (peerId === account.id) {
    res.status(422).json({ ...errorBody('invalid'), fields: { peer_id: 'self' } });
    return;
  }
  const peer = peerId ? await accountById(peerId) : null;
  if (!peer) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const { conversation, created } = await findOrCreateConversation(account.id, peer.id);
  const view = await conversationView(conversation, account);
  res.status(created ? 201 : 200).json(view);
});

router.get('/conversations', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const status = req.query.status === 'request' ? 'request' : 'accepted';
  const rows = await conversationsForSides(account.id, [status]);
  const views = await Promise.all(rows.map((r) => conversationView(r.conversation, account)));
  res.status(200).json({ conversations: views });
});

router.get('/conversations/:id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  res.status(200).json(await conversationView(conversation, account));
});

router.post('/conversations/:id/accept', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  if (side.status !== 'request') {
    res.status(409).json(errorBody('not_a_request'));
    return;
  }
  await acceptConversation(conversation.id, account.id);
  const fresh = await conversationById(conversation.id);
  res.status(200).json(await conversationView(fresh!, account));
});

router.delete('/conversations/:id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  if (side.status !== 'request') {
    res.status(409).json(errorBody('not_a_request'));
    return;
  }
  await deleteRequestFor(conversation.id, account.id);
  res.status(204).end();
});

router.post('/conversations/:id/read', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const through = (req.body as { through_seq?: unknown }).through_seq;
  if (typeof through !== 'number' || !Number.isInteger(through) || through < 0) {
    res.status(422).json(errorBody('invalid'));
    return;
  }
  const changed = await withTransaction((client) => markRead(client, conversation.id, account.id, through));
  for (const letter of changed) {
    pushLetter(letter);
  }
  const fresh = await conversationById(conversation.id);
  res.status(200).json(await conversationView(fresh!, account));
});

router.put('/conversations/:id/mute', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const duration = (req.body as { duration?: unknown }).duration;
  if (duration !== '1h' && duration !== '8h' && duration !== '1w' && duration !== 'always' && duration !== 'off') {
    res.status(422).json(errorBody('invalid'));
    return;
  }
  await setMute(conversation.id, account.id, duration);
  const fresh = await conversationById(conversation.id);
  res.status(200).json(await conversationView(fresh!, account));
});

router.get('/conversations/:id/letters', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const conversation = await conversationById(req.params.id);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const beforeRaw = req.query.before_seq;
  const before = beforeRaw === undefined ? null : Number(beforeRaw);
  if (before !== null && (!Number.isInteger(before) || before < 0)) {
    res.status(422).json(errorBody('invalid'));
    return;
  }
  const limitRaw = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 200) {
    res.status(422).json(errorBody('invalid'));
    return;
  }
  const rows = await lettersOfConversation(conversation.id, before, limitRaw);
  const ascending = [...rows].reverse();
  res.status(200).json({ letters: ascending.map((l) => serializeLetter(l, account.id)) });
});

// --- letters ---

router.post('/letters', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) fields.id = 'invalid';
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : '';
  const klass: 'letter' | 'control' = body.class === 'letter' ? 'letter' : body.class === 'control' ? 'control' : undefined as never;
  if (body.class !== 'letter' && body.class !== 'control') {
    res.status(422).json({ ...errorBody('invalid'), fields: { class: 'invalid' } });
    return;
  }
  const recipientKeyId = typeof body.recipient_key_id === 'string' ? body.recipient_key_id : '';
  if (!recipientKeyId) {
    res.status(422).json({ ...errorBody('invalid'), fields: { recipient_key_id: 'invalid' } });
    return;
  }
  const ivRaw = body.iv;
  const iv = ivRaw === null || ivRaw === undefined ? null : typeof ivRaw === 'string' ? ivRaw : undefined;
  const ctRaw = body.ciphertext;
  const ciphertext = ctRaw === null || ctRaw === undefined ? null : typeof ctRaw === 'string' ? ctRaw : undefined;
  if (iv === undefined || ciphertext === undefined) fields.ciphertext = 'invalid';
  else if (iv !== null && b64urlDecode(iv).length !== IV_BYTES) fields.iv = 'invalid';
  else if (ciphertext !== null) {
    const ctBytes = b64urlDecode(ciphertext);
    if (ctBytes.length % CT_MULTIPLE !== GCM_TAG_BYTES || ctBytes.length > CT_MAX || ctBytes.length === 0) fields.ciphertext = 'invalid';
  } else {
    fields.ciphertext = 'invalid';
  }
  const attachRaw = body.attachment_id;
  const attachmentId = attachRaw === null || attachRaw === undefined ? null : typeof attachRaw === 'string' ? attachRaw : undefined;
  if (attachmentId === undefined) fields.attachment_id = 'invalid';
  if (klass === 'control' && attachmentId !== null) fields.attachment_id = 'invalid';
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  if (iv === undefined || ciphertext === undefined) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  const ivValue: string | null = iv;
  const ciphertextValue: string | null = ciphertext;
  const attachmentValue: string | null = attachmentId ?? null;
  // 404 first for anything not the caller's, including ids inside bodies.
  const conversation = await conversationById(conversationId);
  const side = conversation ? await sideOf(conversation.id, account.id) : null;
  if (!conversation || !side || side.deleted_at !== null) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const recipientId = conversation.starter_id === account.id ? conversation.recipient_id : conversation.starter_id;
  const existing = await letterById(id);
  if (existing) {
    // Replay of a client letter id returns its stored response before any state check.
    const same = existing.conversation_id === conversation.id
      && existing.class === klass
      && existing.recipient_key_id === recipientKeyId
      && existing.iv === ivValue
      && existing.ciphertext === ciphertextValue
      && (existing.attachment_id ?? null) === attachmentValue;
    if (!same) {
      res.status(409).json(errorBody('letter_id_conflict'));
      return;
    }
    res.status(200).json(serializeLetter(existing, account.id));
    return;
  }
  let attachmentState: 'none' | 'stored' | 'not_stored' | 'in_use' = 'none';
  let blob: BlobRow | null = null;
  if (attachmentValue !== null) {
    blob = await blobById(attachmentValue);
    if (!blob || blob.owner_id !== account.id) {
      res.status(404).json(errorBody('not_found'));
      return;
    }
    if (blob.kind !== 'image' && blob.kind !== 'file') {
      res.status(422).json({ ...errorBody('invalid'), fields: { attachment_id: 'unsupported' } });
      return;
    }
    const used = await letterUsingBlob(attachmentValue);
    if (used) {
      attachmentState = 'in_use';
    } else if (blob.state !== 'stored') {
      attachmentState = 'not_stored';
    } else {
      attachmentState = 'stored';
    }
  }
  // Blocking (DP-28): the blocker cannot post to the blocked person (409),
  // and the blocked person's posts are answered as usual but never queued.
  const senderBlockedRecipient = await isBlocked(account.id, recipientId);
  const recipientBlockedSender = await isBlocked(recipientId, account.id);
  const blocked = senderBlockedRecipient || recipientBlockedSender;
  // The 503 for a stored attachment whose storage is unreachable comes after every earlier check.
  if (attachmentState === 'stored' && !(await probe())) {
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  if (attachmentState === 'stored' && attachmentValue !== null) {
    const storedSize = await headObject(account.id, attachmentValue);
    if (storedSize !== blob!.size) {
      attachmentState = 'not_stored';
    }
  }
  try {
    const outcome = await postLetter(account.id, {
      id,
      conversation,
      class: klass,
      recipient_key_id: recipientKeyId,
      iv: ivValue,
      ciphertext: ciphertextValue,
      attachment_id: attachmentValue,
    }, recipientId, senderBlockedRecipient, recipientBlockedSender, attachmentState);
    const letter = outcome.letter;
    pushLetter(letter);
    const freshConversation = await conversationById(conversation.id);
    pushConversation(freshConversation!, account.id);
    pushConversation(freshConversation!, recipientId);
    res.status(201).json(serializeLetter(letter, account.id));
  } catch (error) {
    if (error instanceof LetterConflictError) {
      const extra = error.keyId ? { key_id: error.keyId } : undefined;
      res.status(409).json({ ...errorBody(error.code), ...(extra ?? {}) });
      return;
    }
    throw error;
  }
});

router.get('/letters/:id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const letter = await letterById(req.params.id);
  if (!letter || (letter.sender_id !== account.id && letter.recipient_id !== account.id)) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  res.status(200).json(serializeLetter(letter, account.id));
});

router.post('/letters/:id/retract', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const letter = await letterById(req.params.id);
  if (!letter || (letter.sender_id !== account.id && letter.recipient_id !== account.id)) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  if (letter.sender_id !== account.id) {
    res.status(403).json(errorBody('not_sender'));
    return;
  }
  // A repeat retract answers 200 with the stored letter, unchanged.
  if (letter.retracted_at !== null) {
    res.status(200).json(serializeLetter(letter, account.id));
    return;
  }
  if (!retractWindowOpen(letter, account.id)) {
    res.status(409).json(errorBody('retract_window_closed'));
    return;
  }
  const retracted = await retractLetterRow(letter);
  pushLetter(retracted);
  if (retracted.attachment_id) {
    await deleteObject(letter.sender_id, retracted.attachment_id);
  }
  const conversation = await conversationById(letter.conversation_id);
  if (conversation) {
    pushConversation(conversation, letter.sender_id);
    pushConversation(conversation, letter.recipient_id);
  }
  res.status(200).json(serializeLetter(retracted, account.id));
});

// --- inbox ---

router.get('/inbox', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const letters = await inboxFor(account.id);
  res.status(200).json({ letters: letters.map((l) => serializeLetter(l, account.id)) });
});

router.post('/inbox/ack', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const through = (req.body as { through_seq?: unknown }).through_seq;
  if (typeof through !== 'number' || !Number.isInteger(through) || through < 0) {
    res.status(422).json(errorBody('invalid'));
    return;
  }
  const delivered = await ackInboxFor(account.id, through);
  for (const letter of delivered) {
    pushLetter(letter);
  }
  res.status(200).json({ delivered: delivered.length });
});

// --- blobs ---

router.post('/blobs', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const id = typeof body.id === 'string' ? body.id : '';
  if (body.kind !== 'image' && body.kind !== 'file' && body.kind !== 'photo') fields.kind = 'unsupported';
  const sizeValue = body.size;
  if (typeof sizeValue !== 'number' || !Number.isInteger(sizeValue) || sizeValue <= 0) fields.size = 'invalid';
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ ...errorBody('invalid'), fields });
    return;
  }
  const kind = body.kind as BlobRecord['kind'];
  const size = sizeValue as number;
  if (size > config.attachmentMaxBytes) {
    res.status(413).json(errorBody('too_large'));
    return;
  }
  const existing = await blobById(id);
  if (existing) {
    const same = existing.kind === kind && existing.size === size;
    if (!same) {
      res.status(409).json(errorBody('blob_id_conflict'));
      return;
    }
    res.status(200).json(serializeBlob({ id: existing.id, kind: existing.kind as BlobRecord['kind'], size: existing.size, state: existing.state as BlobRecord['state'] }));
    return;
  }
  await insertBlob(account.id, id, kind, size);
  res.status(201).json(serializeBlob({ id, kind, size, state: 'uploading' }));
});

// Blob content: raw bytes, never parsed as JSON.
router.put('/blobs/:id/content', express.raw({ type: 'application/octet-stream', limit: config.attachmentMaxBytes + 1 }), async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const blob = await blobById(req.params.id);
  if (!blob || blob.owner_id !== account.id) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const bytes = new Uint8Array(req.body as Buffer);
  if (bytes.length > blob.size) {
    res.status(413).json(errorBody('too_large'));
    return;
  }
  if (bytes.length < blob.size) {
    res.status(422).json(errorBody('size_mismatch'));
    return;
  }
  if (blob.state === 'stored') {
    res.status(409).json(errorBody('already_stored'));
    return;
  }
  if (!(await probe())) {
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  const stored = await putSealedBytes(account.id, blob.id, blob.size, bytes);
  if (!stored) {
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  // Marked stored only when the stored object reads back at the declared size.
  const readBack = await headObject(account.id, blob.id);
  if (readBack !== blob.size) {
    await deleteObject(account.id, blob.id);
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  await markBlobStored(blob.id);
  res.status(200).json(serializeBlob({ id: blob.id, kind: blob.kind as BlobRecord['kind'], size: blob.size, state: 'stored' }));
});

router.get('/blobs/:id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const blob = await blobById(req.params.id);
  if (!blob) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  // Participant access, decided in one place: the letters this blob rides on.
  const letters = await lettersUsingBlob(blob.id);
  const isParticipant = letters.some((l) => l.sender_id === account.id || l.recipient_id === account.id);
  let photoAllowed = false;
  if (blob.kind === 'photo') {
    const owner = await accountById(blob.owner_id);
    if (owner) {
      photoAllowed = blob.owner_id === account.id || await sharesAcceptedConversation(account.id, blob.owner_id);
    }
  }
  const ownerAllowed = blob.owner_id === account.id && letters.length === 0;
  if (!isParticipant && !photoAllowed && !ownerAllowed) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  if (!(await probe())) {
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  const bytes = await getSealedBytes(blob.owner_id, blob.id);
  if (!bytes) {
    res.status(503).json(errorBody('storage_unavailable'));
    return;
  }
  res.status(200)
    .setHeader('Content-Type', 'application/octet-stream')
    .setHeader('Content-Disposition', 'attachment')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Cache-Control', 'private, no-store')
    .setHeader('Content-Length', String(bytes.length))
    .end(Buffer.from(bytes));
});

// --- blocks ---

router.get('/blocks', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const rows = await blocksOf(account.id);
  res.status(200).json({ blocks: rows.map((r) => ({ account_id: r.account_id, username: r.username, blocked_at: iso(r.blocked_at) })) });
});

router.put('/blocks/:account_id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const target = await accountById(req.params.account_id);
  if (!target) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  if (target.id === account.id) {
    res.status(422).json({ ...errorBody('invalid'), fields: { account_id: 'self' } });
    return;
  }
  const at = await blockAccount(account.id, target.id);
  await hideBlockedRequests(account.id, target.id);
  res.status(200).json({ account_id: target.id, username: target.username, blocked_at: iso(at) });
});

router.delete('/blocks/:account_id', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const target = await accountById(req.params.account_id);
  if (!target) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  await unblockAccount(account.id, target.id);
  res.status(204).end();
});

// --- seal ---

router.put('/contacts/:account_id/seal', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const peer = await accountById(req.params.account_id);
  if (!peer || !(await sharesAnyConversation(account.id, peer.id))) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const body = req.body as Record<string, unknown>;
  const keyId = typeof body.key_id === 'string' ? body.key_id : '';
  const verified = body.verified === true;
  const peerCurrent = await currentKeyOf(peer.id);
  if (!peerCurrent || keyId !== peerCurrent.key_id) {
    res.status(409).json({ ...errorBody('stale_key'), key_id: peerCurrent?.key_id ?? '' });
    return;
  }
  await setSeal(account.id, peer.id, keyId, verified);
  res.status(200).json({ account_id: peer.id, key_id: keyId, seal: verified ? 'verified' : 'unverified' });
});

// --- grading ---

router.get('/grading/dump', async (req, res) => {
  if (!config.grading) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const tables = ['accounts', 'account_keys', 'key_backups', 'recovery', 'sessions', 'conversations', 'conversation_sides', 'letters', 'blobs', 'blocks', 'name_holds', 'recovery_attempts'];
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await query(`SELECT * FROM ${table}`);
    out[table] = rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
          mapped[key] = Buffer.from(value as unknown as Uint8Array).toString('base64url');
        } else {
          mapped[key] = value;
        }
      }
      return mapped;
    });
  }
  res.status(200).json({ tables: out });
});

router.get('/grading/clock', (_req, res) => {
  if (!config.grading) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  res.status(200).json({ offset_ms: clockOffset(), now: nowIso() });
});

router.post('/grading/clock', (req, res) => {
  if (!config.grading) {
    res.status(404).json(errorBody('not_found'));
    return;
  }
  const offset = (req.body as { offset_ms?: unknown }).offset_ms;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    res.status(422).json({ ...errorBody('invalid'), fields: { offset_ms: 'invalid' } });
    return;
  }
  setClockOffset(offset);
  res.status(200).json({ offset_ms: offset, now: nowIso() });
});


// --- helpers used above ---

interface BlobRow { id: string; owner_id: string; kind: string; size: number; state: string }

async function blobById(id: string): Promise<BlobRow | null> {
  const rows = await query<{ id: string; owner_id: string; kind: string; size: string; state: string }>(
    'SELECT id, owner_id, kind, size, state FROM blobs WHERE id = $1', [id]);
  const row = rows[0];
  return row ? { id: row.id, owner_id: row.owner_id, kind: row.kind, size: Number(row.size), state: row.state } : null;
}

async function insertBlob(ownerId: string, id: string, kind: string, size: number): Promise<void> {
  await query('INSERT INTO blobs (id, owner_id, kind, size, state) VALUES ($1,$2,$3,$4,\'uploading\') ON CONFLICT (id) DO NOTHING', [id, ownerId, kind, size]);
}

async function markBlobStored(id: string): Promise<void> {
  await query('UPDATE blobs SET state = \'stored\' WHERE id = $1', [id]);
}

async function letterUsingBlob(blobId: string): Promise<LetterRecord | null> {
  const rows = await query<LetterRecord>('SELECT * FROM letters WHERE attachment_id = $1 LIMIT 1', [blobId]);
  return rows[0] ?? null;
}

async function lettersUsingBlob(blobId: string): Promise<LetterRecord[]> {
  return query<LetterRecord>('SELECT * FROM letters WHERE attachment_id = $1', [blobId]);
}

async function sharesAnyConversation(a: string, b: string): Promise<boolean> {
  const rows = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM conversations WHERE (starter_id = $1 AND recipient_id = $2) OR (starter_id = $2 AND recipient_id = $1)',
    [a, b]);
  return Number(rows[0].count) > 0;
}

// Blocking hides a pending request; an accepted conversation stays in Chats with Unblock.
async function hideBlockedRequests(blockerId: string, blockedId: string): Promise<void> {
  await query(`UPDATE conversation_sides s SET deleted_at = $3 WHERE s.account_id = $1 AND s.status = 'request' AND s.conversation_id IN (
    SELECT id FROM conversations WHERE (starter_id = $1 AND recipient_id = $2) OR (starter_id = $2 AND recipient_id = $1))`,
    [blockerId, blockedId, now()]);
}

async function retractLetterRow(letter: LetterRecord): Promise<LetterRecord> {
  const rows = await query<LetterRecord>('UPDATE letters SET retracted_at = $2, iv = NULL, ciphertext = NULL WHERE id = $1 RETURNING *', [letter.id, now()]);
  return rows[0];
}

async function ackInboxFor(accountId: string, throughSeq: number): Promise<LetterRecord[]> {
  const rows = await query<LetterRecord>(
    'UPDATE letters SET state = \'delivered\', delivered_at = $2, iv = NULL, ciphertext = NULL WHERE recipient_id = $1 AND state = \'sent\' AND seq <= $3 RETURNING *',
    [accountId, now(), throughSeq]);
  return rows;
}

async function conversationView(conversation: ConversationRecord, account: AccountRecord): Promise<Conversation> {
  const side = await sideOf(conversation.id, account.id);
  const peerId = conversation.starter_id === account.id ? conversation.recipient_id : conversation.starter_id;
  const peer = await accountById(peerId);
  const peerCurrent = await currentKeyOf(peerId);
  const seal = sealStatusOf(peerCurrent!.key_id, side!.accepted_key_id, side!.seal_verified);
  const shared = await sharesAcceptedConversation(account.id, peerId);
  const acceptedForBoth = shared && side!.status === 'accepted';
  const peerProfile = acceptedForBoth && peer!.profile_iv && peer!.profile_ciphertext
    ? { iv: peer!.profile_iv, ciphertext: peer!.profile_ciphertext, photo_blob_id: peer!.profile_photo_blob_id }
    : null;
  const unread = await unreadCount(conversation.id, account.id);
  const lastLetter = await lastLetterForSides(conversation.id, account.id);
  const blocked = await isBlocked(account.id, peerId);
  return serializeConversation({
    conversation,
    side: side!,
    peer: { id: peer!.id, username: peer!.username, key_id: peerCurrent!.key_id, public_key: peerCurrent!.public_key, seal, profile: peerProfile },
    unread,
    lastLetter,
    viewerId: account.id,
    blocked,
  });
}

function pushLetter(letter: LetterRecord): void {
  hub.send(letter.sender_id, { type: 'letter', letter: serializeLetter(letter, letter.sender_id) });
  hub.send(letter.recipient_id, { type: 'letter', letter: serializeLetter(letter, letter.recipient_id) });
}

async function pushConversation(conversation: ConversationRecord, accountId: string): Promise<void> {
  const account = await accountById(accountId);
  if (!account) return;
  const view = await conversationView(conversation, account);
  hub.send(accountId, { type: 'conversation', conversation: view });
}

export default router;
