import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { base64urlDecode, base64urlEncode } from '../../shared/scheme.js';
import type {
  KeyBackupRecord,
  KeyRecord,
  LookupRecord,
  PreviewSetting,
} from '../../shared/types.js';
import { serverNow } from '../clock.js';
import {
  RECOVER_MAX_FAILURES,
  RECOVER_WINDOW_MS,
  USERNAME_COOLDOWN_MS,
  USERNAME_HOLD_MS,
} from '../config.js';
import { pool, transaction } from '../db.js';
import { loadBlob } from '../domain/access.js';
import { accountRecord } from '../domain/accounts.js';
import { accountRow, currentKey, sealedProfile } from '../domain/conversations.js';
import { decodePublicKey, keyIdFor } from '../domain/keys.js';
import { isIv, isSealedBlob, isSealedBody, isSealedBytes } from '../domain/sealed.js';
import { availability, isTaken, normaliseUsername, syntaxReason } from '../domain/usernames.js';
import {
  ApiError,
  conflict,
  invalidField,
  isUuidV4,
  notFound,
  requireString,
  sendJson,
  ValidationError,
  type RequestContext,
} from '../http.js';
import { signOutOthers } from '../hub.js';
import { pushConversation, pushKeyChange } from '../push.js';
import { createSession, revokeOtherSessions, setSessionCookie } from '../session.js';
import { confirmStoredBlob } from './blobs.js';

const UNIQUE_VIOLATION = '23505';

function verifierHash(salt: Buffer, verifier: Uint8Array): Buffer {
  return createHash('sha256').update(salt).update(verifier).digest();
}

interface KeyBackupInput {
  iv: string;
  ciphertext: string;
}

function readKeyBackup(value: unknown): KeyBackupInput {
  if (value === null || typeof value !== 'object') throw invalidField('key_backup', 'invalid');
  const backup = value as Record<string, unknown>;
  if (!isIv(backup['iv']) || !isSealedBlob(backup['ciphertext'])) {
    throw invalidField('key_backup', 'invalid');
  }
  return { iv: backup['iv'], ciphertext: backup['ciphertext'] };
}

export async function postAccount(ctx: RequestContext): Promise<void> {
  const rawUsername = typeof ctx.body['username'] === 'string' ? ctx.body['username'] : '';
  const check = await availability(pool, rawUsername);
  if (check.reason === 'taken') throw conflict('username_taken');
  if (check.reason !== null) throw invalidField('username', check.reason);

  const publicKey = decodePublicKey(ctx.body['public_key']);
  if (publicKey === null) throw invalidField('public_key', 'invalid');
  if (!isSealedBytes(ctx.body['recovery_verifier'], 32)) {
    throw invalidField('recovery_verifier', 'invalid');
  }
  const backup = readKeyBackup(ctx.body['key_backup']);

  const now = serverNow();
  const salt = randomBytes(16);
  const hash = verifierHash(salt, base64urlDecode(ctx.body['recovery_verifier'] as string));
  const accountId = randomUUID();
  const keyId = keyIdFor(publicKey);

  const token = await transaction(async (client) => {
    try {
      await client.query(
        `insert into accounts (id, username, recovery_salt, recovery_hash, created_at)
         values ($1, $2, $3, $4, $5)`,
        [accountId, check.username, salt, hash, now],
      );
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw conflict('username_taken');
      throw error;
    }
    await client.query(
      `insert into account_keys (account_id, key_id, public_key, created_at, is_current)
       values ($1, $2, $3, $4, true)`,
      [accountId, keyId, Buffer.from(publicKey), now],
    );
    await client.query(
      `insert into key_backups (account_id, key_id, iv, ciphertext, created_at)
       values ($1, $2, $3, $4, $5)`,
      [accountId, keyId, backup.iv, backup.ciphertext, now],
    );
    return createSession(client, accountId);
  });

  setSessionCookie(ctx.res, token);
  sendJson(ctx.res, 201, await accountRecord(pool, accountId));
}

export async function getMe(ctx: RequestContext): Promise<void> {
  sendJson(ctx.res, 200, await accountRecord(pool, ctx.accountId));
}

export async function putProfile(ctx: RequestContext): Promise<void> {
  const photoValue = ctx.body['photo_blob_id'] ?? null;
  let photoBlobId: string | null = null;
  if (photoValue !== null) {
    if (!isUuidV4(photoValue)) throw notFound();
    const blob = await loadBlob(pool, photoValue);
    if (blob.owner_id !== ctx.accountId || blob.kind !== 'photo') throw notFound();
    if (blob.state !== 'stored') throw conflict('attachment_not_stored');
    photoBlobId = blob.id;
  }

  if (!isIv(ctx.body['iv'])) throw invalidField('iv', 'invalid');
  if (!isSealedBody(ctx.body['ciphertext'])) throw invalidField('ciphertext', 'invalid');

  if (photoBlobId !== null) await confirmStoredBlob(ctx.accountId, photoBlobId);

  await pool.query(
    `update accounts set profile_iv = $2, profile_ciphertext = $3, profile_photo_blob_id = $4
      where id = $1`,
    [ctx.accountId, ctx.body['iv'], ctx.body['ciphertext'], photoBlobId],
  );
  await pushToContacts(ctx.accountId);
  sendJson(ctx.res, 200, await accountRecord(pool, ctx.accountId));
}

export async function patchSettings(ctx: RequestContext): Promise<void> {
  const fields: Record<string, string> = {};
  const receipts = ctx.body['read_receipts'];
  const preview = ctx.body['preview'];
  if (receipts !== undefined && typeof receipts !== 'boolean') fields['read_receipts'] = 'invalid';
  const previews: PreviewSetting[] = ['name_and_letter', 'name_only', 'none'];
  if (preview !== undefined && !previews.includes(preview as PreviewSetting)) {
    fields['preview'] = 'invalid';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  if (typeof receipts === 'boolean') {
    await pool.query('update accounts set read_receipts = $2 where id = $1', [
      ctx.accountId,
      receipts,
    ]);
  }
  if (typeof preview === 'string') {
    await pool.query('update accounts set preview = $2 where id = $1', [ctx.accountId, preview]);
  }
  sendJson(ctx.res, 200, await accountRecord(pool, ctx.accountId));
}

export async function patchUsername(ctx: RequestContext): Promise<void> {
  const account = await accountRow(pool, ctx.accountId);
  const now = serverNow();
  if (
    account.username_changed_at !== null &&
    now.getTime() < account.username_changed_at.getTime() + USERNAME_COOLDOWN_MS
  ) {
    throw conflict('username_cooldown', {
      retry_at: new Date(account.username_changed_at.getTime() + USERNAME_COOLDOWN_MS).toISOString(),
    });
  }

  const requested = normaliseUsername(requireString(ctx.body['username'], 'username'));
  const syntax = syntaxReason(requested);
  if (syntax !== null) throw invalidField('username', syntax);
  if (requested === account.username) throw invalidField('username', 'same');
  if (await isTaken(pool, requested)) throw conflict('username_taken');

  try {
    await transaction(async (client) => {
      await client.query(
        `insert into username_holds (username, released_at, held_until) values ($1, $2, $3)
         on conflict (username) do update set released_at = $2, held_until = $3`,
        [account.username, now, new Date(now.getTime() + USERNAME_HOLD_MS)],
      );
      await client.query(
        'update accounts set username = $2, username_changed_at = $3 where id = $1',
        [ctx.accountId, requested, now],
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw conflict('username_taken');
    throw error;
  }

  await pushToContacts(ctx.accountId);
  sendJson(ctx.res, 200, await accountRecord(pool, ctx.accountId));
}

interface RecoverAttempts {
  failures: number;
  windowStart: number;
}

const recoverAttempts = new Map<string, RecoverAttempts>();

function recoverBlocked(username: string, now: number): boolean {
  const record = recoverAttempts.get(username);
  if (record === undefined) return false;
  if (now - record.windowStart >= RECOVER_WINDOW_MS) {
    recoverAttempts.delete(username);
    return false;
  }
  return record.failures >= RECOVER_MAX_FAILURES;
}

function recordRecoverFailure(username: string, now: number): void {
  const record = recoverAttempts.get(username);
  if (record === undefined || now - record.windowStart >= RECOVER_WINDOW_MS) {
    recoverAttempts.set(username, { failures: 1, windowStart: now });
    return;
  }
  record.failures += 1;
}

export async function postRecover(ctx: RequestContext): Promise<void> {
  const now = serverNow();
  const username = normaliseUsername(
    typeof ctx.body['username'] === 'string' ? ctx.body['username'] : '',
  );
  if (recoverBlocked(username, now.getTime())) throw new ApiError(429, 'too_many_attempts');

  if (!isSealedBytes(ctx.body['recovery_verifier'], 32)) {
    throw invalidField('recovery_verifier', 'invalid');
  }
  const publicKey = decodePublicKey(ctx.body['public_key']);
  if (publicKey === null) throw invalidField('public_key', 'invalid');
  const backup = readKeyBackup(ctx.body['key_backup']);

  const found = await pool.query<{ id: string; recovery_salt: Buffer; recovery_hash: Buffer }>(
    'select id, recovery_salt, recovery_hash from accounts where username = $1',
    [username],
  );
  const account = found.rows[0];
  const verifier = base64urlDecode(ctx.body['recovery_verifier'] as string);
  const expected = account === undefined ? randomBytes(32) : account.recovery_hash;
  const candidate =
    account === undefined ? randomBytes(32) : verifierHash(account.recovery_salt, verifier);
  const matches = expected.length === candidate.length && timingSafeEqual(expected, candidate);
  if (account === undefined || !matches) {
    recordRecoverFailure(username, now.getTime());
    throw new ApiError(401, 'recovery_failed');
  }
  recoverAttempts.delete(username);

  const accountId = account.id;
  const keyId = keyIdFor(publicKey);
  const earlier = await pool.query<KeyBackupRecord & { created_at: Date }>(
    `select key_id, iv, ciphertext, created_at from key_backups
      where account_id = $1 and key_id <> $2 order by created_at asc`,
    [accountId, keyId],
  );

  const token = await transaction(async (client) => {
    await client.query('update account_keys set is_current = false where account_id = $1', [
      accountId,
    ]);
    await client.query(
      `insert into account_keys (account_id, key_id, public_key, created_at, is_current)
       values ($1, $2, $3, $4, true)
       on conflict (account_id, key_id) do update set is_current = true`,
      [accountId, keyId, Buffer.from(publicKey), now],
    );
    await client.query(
      `insert into key_backups (account_id, key_id, iv, ciphertext, created_at)
       values ($1, $2, $3, $4, $5)
       on conflict (account_id, key_id) do update set iv = $3, ciphertext = $4`,
      [accountId, keyId, backup.iv, backup.ciphertext, now],
    );
    const fresh = await createSession(client, accountId);
    await revokeOtherSessions(client, accountId, fresh);
    return fresh;
  });

  signOutOthers(accountId, token);
  await pushKeyChange(accountId);
  setSessionCookie(ctx.res, token);
  sendJson(ctx.res, 200, {
    account: await accountRecord(pool, accountId),
    key_backups: earlier.rows.map((row) => ({
      key_id: row.key_id,
      iv: row.iv,
      ciphertext: row.ciphertext,
      created_at: new Date(row.created_at).toISOString(),
    })),
  });
}

export async function getLookup(ctx: RequestContext): Promise<void> {
  const raw = ctx.url.searchParams.get('username') ?? '';
  const username = normaliseUsername(raw);
  const found = await pool.query<{ id: string }>('select id from accounts where username = $1', [
    username,
  ]);
  const id = found.rows[0]?.id;
  if (id === undefined || id === ctx.accountId) throw notFound();

  const account = await accountRow(pool, id);
  const key = await currentKey(pool, id);
  const shared = await pool.query(
    `select 1 from conversation_sides mine
       join conversation_sides theirs on theirs.conversation_id = mine.conversation_id
      where mine.account_id = $1 and theirs.account_id = $2 and mine.accepted and theirs.accepted`,
    [ctx.accountId, id],
  );
  const record: LookupRecord = {
    id: account.id,
    username: account.username,
    key_id: key.key_id,
    public_key: base64urlEncode(key.public_key),
    profile: shared.rows.length > 0 ? sealedProfile(account) : null,
  };
  sendJson(ctx.res, 200, record);
}

export async function getAccountKeys(ctx: RequestContext): Promise<void> {
  const accountId = ctx.params['id'] ?? '';
  if (!isUuidV4(accountId)) throw notFound();
  const exists = await pool.query('select 1 from accounts where id = $1', [accountId]);
  if (exists.rows.length === 0) throw notFound();
  const keys = await pool.query<{
    key_id: string;
    public_key: Buffer;
    created_at: Date;
    is_current: boolean;
  }>(
    'select key_id, public_key, created_at, is_current from account_keys where account_id = $1 order by created_at asc',
    [accountId],
  );
  const records: KeyRecord[] = keys.rows.map((row) => ({
    key_id: row.key_id,
    public_key: base64urlEncode(row.public_key),
    created_at: row.created_at.toISOString(),
    current: row.is_current,
  }));
  sendJson(ctx.res, 200, { keys: records });
}

/** Contacts see a changed username or profile on their next conversation frame. */
async function pushToContacts(accountId: string): Promise<void> {
  const rows = await pool.query<{ conversation_id: string; account_id: string }>(
    `select s.conversation_id, s.account_id from conversation_sides s
       join conversation_sides mine on mine.conversation_id = s.conversation_id
      where mine.account_id = $1 and s.account_id <> $1`,
    [accountId],
  );
  for (const row of rows.rows) {
    await pushConversation(row.conversation_id, [row.account_id]);
  }
}
