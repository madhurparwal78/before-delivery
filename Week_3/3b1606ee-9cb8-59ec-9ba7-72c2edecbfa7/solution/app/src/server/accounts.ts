import { randomUUID } from 'node:crypto';
import { requireAccount, profileShared } from './access.js';
import { createSession, hashVerifier, newSalt, revokeOtherSessions, sessionCookie, sha256, verifierMatches } from './auth.js';
import { after, DAY, now, SECOND } from './clock.js';
import { discardBlobs, liveBlob, objectConfirmed } from './blobs.js';
import { one, pool, query, transaction, type Queryable } from './db.js';
import { announceToContacts } from './events.js';
import { signOutOthers } from './hub.js';
import { ApiError, authed, invalid, notFound, open } from './http.js';
import { accountRecord, iso } from './records.js';
import type { AccountRow } from './rows.js';
import {
  RESERVED_USERNAMES,
  normalizeUsername,
  usernameSyntaxProblem,
  type UsernameReason,
} from '../shared/usernames.js';
import { asRecord, decodeBase64url, encodeBase64url, jsonBody, validCiphertext, validIv, validPublicKey } from './validate.js';

const COOLDOWN_MS = 7 * DAY;
const NAME_HOLD_MS = 14 * DAY;
const RESTORE_TRIES = 5;
const RESTORE_WINDOW_MS = 60 * SECOND;
const VERIFIER_BYTES = 32;
const BACKUP_MAX_BYTES = 1024;
const UNIQUE_VIOLATION = '23505';

const keyIdOf = (publicKey: Buffer): string => encodeBase64url(sha256(publicKey).subarray(0, 12));

async function usernameProblem(db: Queryable, name: string): Promise<UsernameReason | null> {
  const syntax = usernameSyntaxProblem(name);
  if (syntax) return syntax;
  if (RESERVED_USERNAMES.includes(name)) return 'taken';
  const held = await one(db, 'SELECT 1 FROM username_holds WHERE username = $1 AND held_until > $2', [name, now()]);
  const used = await one(db, 'SELECT 1 FROM accounts WHERE username = $1', [name]);
  return held || used ? 'taken' : null;
}

function keyBackup(value: unknown): { iv: Buffer; ciphertext: Buffer } | null {
  const input = asRecord(value);
  const iv = validIv(input.iv);
  const ciphertext = decodeBase64url(input.ciphertext);
  return iv && ciphertext && ciphertext.length > 16 && ciphertext.length <= BACKUP_MAX_BYTES ? { iv, ciphertext } : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

export function registerAccountRoutes(): void {
  open('GET', '/api/usernames/:username/availability', async ({ params }) => {
    const username = normalizeUsername(params.username ?? '');
    const reason = await usernameProblem(pool, username);
    return { status: 200, body: { username, available: reason === null, reason } };
  });

  open('POST', '/api/accounts', async ({ body }) => {
    const input = jsonBody(body);
    const username = typeof input.username === 'string' ? normalizeUsername(input.username) : '';
    const syntax = usernameSyntaxProblem(username);
    if (!syntax && (await usernameProblem(pool, username))) throw new ApiError(409, 'username_taken');
    const fields: Record<string, string> = {};
    if (syntax || typeof input.username !== 'string') fields.username = syntax ?? 'length';
    const publicKey = validPublicKey(input.public_key);
    if (!publicKey) fields.public_key = 'invalid';
    const verifier = decodeBase64url(input.recovery_verifier);
    if (!verifier || verifier.length !== VERIFIER_BYTES) fields.recovery_verifier = 'invalid';
    const backup = keyBackup(input.key_backup);
    if (!backup) fields.key_backup = 'invalid';
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const at = now();
    const id = randomUUID();
    const salt = newSalt();
    try {
      const made = await transaction(async (db) => {
        if (await one(db, 'SELECT 1 FROM username_holds WHERE username = $1 AND held_until > $2', [username, at])) {
          throw new ApiError(409, 'username_taken');
        }
        const [account] = await query<AccountRow>(
          db,
          `INSERT INTO accounts (id, username, key_id, public_key, recovery_salt, recovery_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [id, username, keyIdOf(publicKey!), publicKey, salt, hashVerifier(salt, verifier!), at],
        );
        await query(
          db,
          `INSERT INTO account_keys (account_id, key_id, public_key, backup_iv, backup_ciphertext, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, keyIdOf(publicKey!), publicKey, backup!.iv, backup!.ciphertext, at],
        );
        return { account: account!, session: await createSession(db, id, at) };
      });
      return { status: 201, body: accountRecord(made.account), headers: { 'Set-Cookie': sessionCookie(made.session.token) } };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'username_taken');
      throw error;
    }
  });

  authed('GET', '/api/me', async ({ account }) => ({ status: 200, body: accountRecord(account) }));

  authed('PUT', '/api/me/profile', async ({ account, body }) => {
    const input = jsonBody(body);
    const photoId = input.photo_blob_id ?? null;
    let photo = null;
    if (photoId !== null) {
      if (typeof photoId !== 'string') throw invalid({ photo_blob_id: 'invalid' });
      photo = await liveBlob(pool, photoId);
      if (!photo || photo.owner_id !== account.id) throw notFound();
      if (photo.state !== 'stored') throw new ApiError(409, 'attachment_not_stored');
    }
    const iv = validIv(input.iv);
    const ciphertext = validCiphertext(input.ciphertext);
    const fields: Record<string, string> = {};
    if (!iv) fields.iv = 'invalid';
    if (!ciphertext) fields.ciphertext = 'invalid';
    if (photo && photo.kind !== 'photo') fields.photo_blob_id = 'invalid';
    if (Object.keys(fields).length > 0) throw invalid(fields);
    if (photo && !(await objectConfirmed(photo))) throw new ApiError(409, 'attachment_not_stored');
    const [updated] = await query<AccountRow>(
      pool,
      'UPDATE accounts SET profile_iv = $2, profile_ciphertext = $3, profile_photo_blob_id = $4 WHERE id = $1 RETURNING *',
      [account.id, iv, ciphertext, photo?.id ?? null],
    );
    if (account.profile_photo_blob_id && account.profile_photo_blob_id !== (photo?.id ?? null)) {
      await discardBlobs(pool, [account.profile_photo_blob_id], now());
    }
    await announceToContacts(account.id, false);
    return { status: 200, body: accountRecord(updated!) };
  });

  authed('PATCH', '/api/me/settings', async ({ account, body }) => {
    const input = jsonBody(body);
    const fields: Record<string, string> = {};
    if ('read_receipts' in input && typeof input.read_receipts !== 'boolean') fields.read_receipts = 'invalid';
    if ('preview' in input && input.preview !== 'name_and_letter' && input.preview !== 'name_only' && input.preview !== 'none') fields.preview = 'invalid';
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const [updated] = await query<AccountRow>(
      pool,
      'UPDATE accounts SET read_receipts = COALESCE($2, read_receipts), preview = COALESCE($3, preview) WHERE id = $1 RETURNING *',
      [account.id, input.read_receipts ?? null, input.preview ?? null],
    );
    return { status: 200, body: accountRecord(updated!) };
  });

  authed('PATCH', '/api/me/username', async ({ account, body }) => {
    const input = jsonBody(body);
    const at = now();
    if (account.username_changed_at) {
      const retryAt = after(account.username_changed_at, COOLDOWN_MS);
      if (retryAt.getTime() > at.getTime()) throw new ApiError(409, 'username_cooldown', { retry_at: iso(retryAt) });
    }
    const username = typeof input.username === 'string' ? normalizeUsername(input.username) : '';
    const syntax = usernameSyntaxProblem(username);
    if (syntax || typeof input.username !== 'string') throw invalid({ username: syntax ?? 'length' });
    if (username === account.username) throw invalid({ username: 'same' });
    try {
      const updated = await transaction(async (db) => {
        if (await usernameProblem(db, username)) throw new ApiError(409, 'username_taken');
        await query(
          db,
          `INSERT INTO username_holds (username, held_until) VALUES ($1, $2)
           ON CONFLICT (username) DO UPDATE SET held_until = EXCLUDED.held_until`,
          [account.username, after(at, NAME_HOLD_MS)],
        );
        const [row] = await query<AccountRow>(db, 'UPDATE accounts SET username = $2, username_changed_at = $3 WHERE id = $1 RETURNING *', [account.id, username, at]);
        return row!;
      });
      await announceToContacts(account.id, false);
      return { status: 200, body: accountRecord(updated) };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'username_taken');
      throw error;
    }
  });

  open('POST', '/api/recover', async ({ body }) => {
    const input = jsonBody(body);
    const username = typeof input.username === 'string' ? normalizeUsername(input.username) : '';
    const verifier = decodeBase64url(input.recovery_verifier);
    const publicKey = validPublicKey(input.public_key);
    const backup = keyBackup(input.key_backup);
    const fields: Record<string, string> = {};
    if (username === '') fields.username = 'invalid';
    if (!verifier || verifier.length !== VERIFIER_BYTES) fields.recovery_verifier = 'invalid';
    if (!publicKey) fields.public_key = 'invalid';
    if (!backup) fields.key_backup = 'invalid';
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const at = now();
    const recent = await one<{ tries: number }>(
      pool,
      'SELECT count(*) AS tries FROM recovery_failures WHERE username = $1 AND failed_at > $2',
      [username, new Date(at.getTime() - RESTORE_WINDOW_MS)],
    );
    if ((recent?.tries ?? 0) >= RESTORE_TRIES) throw new ApiError(429, 'too_many_attempts');
    const account = await one<AccountRow>(pool, 'SELECT * FROM accounts WHERE username = $1', [username]);
    if (!account || !verifierMatches(account, verifier!)) {
      await query(pool, 'INSERT INTO recovery_failures (username, failed_at) VALUES ($1, $2)', [username, at]);
      throw new ApiError(401, 'recovery_failed');
    }
    const keyId = keyIdOf(publicKey!);
    const earlier = await query<{ key_id: string; backup_iv: Buffer; backup_ciphertext: Buffer; created_at: Date }>(
      pool,
      'SELECT key_id, backup_iv, backup_ciphertext, created_at FROM account_keys WHERE account_id = $1 AND key_id <> $2 ORDER BY n',
      [account.id, keyId],
    );
    const restored = await transaction(async (db) => {
      await query(
        db,
        `INSERT INTO account_keys (account_id, key_id, public_key, backup_iv, backup_ciphertext, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_id, key_id) DO UPDATE SET backup_iv = EXCLUDED.backup_iv, backup_ciphertext = EXCLUDED.backup_ciphertext`,
        [account.id, keyId, publicKey, backup!.iv, backup!.ciphertext, at],
      );
      const [row] = await query<AccountRow>(db, 'UPDATE accounts SET key_id = $2, public_key = $3 WHERE id = $1 RETURNING *', [account.id, keyId, publicKey]);
      const session = await createSession(db, account.id, at);
      await revokeOtherSessions(db, account.id, session.hash);
      return { account: row!, session };
    });
    signOutOthers(account.id, restored.session.hash);
    await announceToContacts(account.id, true);
    return {
      status: 200,
      body: {
        account: accountRecord(restored.account),
        key_backups: earlier.map((key) => ({
          key_id: key.key_id,
          iv: encodeBase64url(key.backup_iv),
          ciphertext: encodeBase64url(key.backup_ciphertext),
          created_at: iso(key.created_at),
        })),
      },
      headers: { 'Set-Cookie': sessionCookie(restored.session.token) },
    };
  });

  authed('GET', '/api/lookup', async ({ account, query: search }) => {
    const username = normalizeUsername(search.get('username') ?? '');
    const found = username === account.username ? null : await one<AccountRow>(pool, 'SELECT * FROM accounts WHERE username = $1', [username]);
    if (!found) throw notFound();
    const shared = found.profile_iv && found.profile_ciphertext && (await profileShared(pool, account.id, found.id));
    return {
      status: 200,
      body: {
        id: found.id,
        username: found.username,
        key_id: found.key_id,
        public_key: encodeBase64url(found.public_key),
        profile:
          shared && found.profile_iv && found.profile_ciphertext
            ? { iv: encodeBase64url(found.profile_iv), ciphertext: encodeBase64url(found.profile_ciphertext), photo_blob_id: found.profile_photo_blob_id }
            : null,
      },
    };
  });

  authed('GET', '/api/accounts/:id/keys', async ({ params }) => {
    const target = await requireAccount(pool, params.id);
    const keys = await query<{ key_id: string; public_key: Buffer; created_at: Date }>(
      pool,
      'SELECT key_id, public_key, created_at FROM account_keys WHERE account_id = $1 ORDER BY n',
      [target.id],
    );
    return {
      status: 200,
      body: {
        keys: keys.map((key) => ({
          key_id: key.key_id,
          public_key: encodeBase64url(key.public_key),
          created_at: iso(key.created_at),
          current: key.key_id === target.key_id,
        })),
      },
    };
  });
}

