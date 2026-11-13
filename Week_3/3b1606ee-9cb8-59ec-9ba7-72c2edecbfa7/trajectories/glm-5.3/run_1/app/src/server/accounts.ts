import { createHash, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { b64urlDecode } from '../shared/b64.js';
import { isReserved, usernameShape, type UsernameReason } from '../shared/username.js';
import { MAX_ATTEMPTS, NAME_HOLD_DAYS, RETRY_WINDOW_SECONDS, USERNAME_COOLDOWN_DAYS } from '../shared/sealing-spec.js';
import { now } from './clock.js';
import { pool, query, txQuery, withTransaction } from './db.js';
import { newId } from './store.js';

export interface AccountRecord {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  read_receipts: boolean;
  preview: 'name_and_letter' | 'name_only' | 'none';
  profile_iv: string | null;
  profile_ciphertext: string | null;
  profile_photo_blob_id: string | null;
  username_changed_at: Date | null;
  created_at: Date;
}

export interface SessionToken {
  token: string;
  account_id: string;
}

export async function accountById(id: string): Promise<AccountRecord | null> {
  const rows = await query<AccountRecord & { key_id: string; public_key: string }>(`
    SELECT a.id, a.username, a.read_receipts, a.preview, a.profile_iv, a.profile_ciphertext, a.profile_photo_blob_id,
           a.username_changed_at, a.created_at, k.key_id, k.public_key
    FROM accounts a JOIN account_keys k ON k.account_id = a.id
    WHERE a.id = $1 AND k.created_at = (SELECT MAX(created_at) FROM account_keys WHERE account_id = a.id)
  `, [id]);
  return rows[0] ?? null;
}

export async function accountByUsername(username: string): Promise<AccountRecord | null> {
  const rows = await query<AccountRecord & { key_id: string; public_key: string }>(`
    SELECT a.id, a.username, a.read_receipts, a.preview, a.profile_iv, a.profile_ciphertext, a.profile_photo_blob_id,
           a.username_changed_at, a.created_at, k.key_id, k.public_key
    FROM accounts a JOIN account_keys k ON k.account_id = a.id
    WHERE lower(a.username) = lower($1) AND k.created_at = (SELECT MAX(created_at) FROM account_keys WHERE account_id = a.id)
  `, [username]);
  return rows[0] ?? null;
}

export async function keyHistory(accountId: string): Promise<Array<{ key_id: string; public_key: string; created_at: Date }>> {
  return query(`SELECT key_id, public_key, created_at FROM account_keys WHERE account_id = $1 ORDER BY created_at ASC, key_id ASC`, [accountId]);
}

/** Verifies the raw public key is a valid P-256 uncompressed point by importing it. */
export function isValidP256Point(publicKeyB64: string): boolean {
  try {
    const raw = b64urlDecode(publicKeyB64);
    if (raw.length !== 65 || raw[0] !== 0x04) return false;
    const jwk = pointToJwk(raw);
    createPublicKey({ key: jwk, format: 'jwk' });
    return true;
  } catch {
    return false;
  }
}

function pointToJwk(raw: Uint8Array): { kty: string; crv: string; x: string; y: string } {
  const x = Buffer.from(raw.slice(1, 33)).toString('base64url');
  const y = Buffer.from(raw.slice(33, 65)).toString('base64url');
  return { kty: 'EC', crv: 'P-256', x, y };
}

export async function keyIdOf(publicKeyB64: string): Promise<string> {
  const digest = createHash('sha256').update(Buffer.from(b64urlDecode(publicKeyB64))).digest();
  return digest.subarray(0, 12).toString('base64url');
}

export class UsernameTakenError extends Error {}
export class UsernameCooldownError extends Error {
  constructor(public retryAt: Date) { super('username_cooldown'); }
}
export class UsernameInvalidError extends Error {
  constructor(public reason: Exclude<UsernameReason, 'taken'>) { super('invalid'); }
}
export class SameUsernameError extends Error {
  constructor() { super('same'); }
}

interface UsernameAvailabilityDb {
  inUse: boolean;
  heldUntil: Date | null;
}

async function dbAvailability(username: string): Promise<UsernameAvailabilityDb> {
  const rows = await query<{ count: string; held_until: Date | null }>(
    `SELECT
       (SELECT COUNT(*) FROM accounts WHERE lower(username) = lower($1)) AS count,
       (SELECT held_until FROM name_holds WHERE username = lower($1)) AS held_until`,
    [username],
  );
  return { inUse: Number(rows[0].count) > 0, heldUntil: rows[0].held_until ?? null };
}

/** Availability with reasons in the published order. */
export async function availability(rawInput: string): Promise<{ username: string; available: boolean; reason: UsernameReason | null }> {
  const { reason, username } = usernameShape(rawInput);
  if (reason) return { username, available: false, reason };
  if (isReserved(username)) return { username, available: false, reason: 'taken' };
  const db = await dbAvailability(username);
  if (db.inUse) return { username, available: false, reason: 'taken' };
  if (db.heldUntil && db.heldUntil.getTime() > now().getTime()) return { username, available: false, reason: 'taken' };
  return { username, available: true, reason: null };
}

async function claimable(username: string, client?: PoolClient): Promise<Exclude<UsernameReason, 'never'> | null> {
  const shape = usernameShape(username);
  if (shape.reason) return shape.reason;
  if (isReserved(username)) return 'taken' as const;
  const rows = client
    ? await txQuery<{ count: string; held_until: Date | null }>(client,
        `SELECT (SELECT COUNT(*) FROM accounts WHERE lower(username) = lower($1)) AS count,
                (SELECT held_until FROM name_holds WHERE username = lower($1)) AS held_until`, [username])
    : await query<{ count: string; held_until: Date | null }>(
        `SELECT (SELECT COUNT(*) FROM accounts WHERE lower(username) = lower($1)) AS count,
                (SELECT held_until FROM name_holds WHERE username = lower($1)) AS held_until`, [username]);
  if (Number(rows[0].count) > 0) return 'taken' as const;
  const heldUntil = rows[0].held_until;
  if (heldUntil && heldUntil.getTime() > now().getTime()) return 'taken' as const;
  return null;
}

export interface NewAccountInput {
  username: string;
  public_key: string;
  recovery_verifier: string;
  key_backup: { iv: string; ciphertext: string };
}

export interface CreateAccountResult {
  account: AccountRecord;
  sessionToken: string;
}

export async function createAccount(input: NewAccountInput): Promise<CreateAccountResult> {
  return withTransaction(async (client) => {
    const { username } = usernameShape(input.username);
    const claim = await claimable(username, client);
    if (claim) {
      if (claim === 'taken') throw new UsernameTakenError();
      throw new UsernameInvalidError(claim);
    }
    const id = newId();
    const createdAt = now();
    const keyId = await keyIdOf(input.public_key);
    await txQuery(client, 'INSERT INTO accounts (id, username, created_at, read_receipts, preview) VALUES ($1,$2,$3,TRUE,$4)',
      [id, username, createdAt, 'name_and_letter']);
    await txQuery(client, 'INSERT INTO account_keys (key_id, account_id, public_key, created_at) VALUES ($1,$2,$3,$4)',
      [keyId, id, input.public_key, createdAt]);
    const salt = randomBytes(16).toString('base64url');
    const verifierHash = hashVerifier(input.recovery_verifier, salt);
    await txQuery(client, 'INSERT INTO recovery (account_id, salt, verifier_hash) VALUES ($1,$2,$3)', [id, salt, verifierHash]);
    await txQuery(client, 'INSERT INTO key_backups (key_id, account_id, iv, ciphertext, created_at) VALUES ($1,$2,$3,$4,$5)',
      [keyId, id, input.key_backup.iv, input.key_backup.ciphertext, createdAt]);
    const token = await createSession(id, client);
    const account = await fetchAccountInTx(client, id);
    return { account: account!, sessionToken: token };
  });
}

function hashVerifier(verifierB64: string, saltB64: string): string {
  return createHash('sha256').update(Buffer.from(verifierB64)).update(Buffer.from(saltB64)).digest('base64url');
}

async function fetchAccountInTx(client: PoolClient, id: string): Promise<AccountRecord | null> {
  const rows = await txQuery<AccountRecord>(client, `
    SELECT a.id, a.username, a.read_receipts, a.preview, a.profile_iv, a.profile_ciphertext, a.profile_photo_blob_id,
           a.username_changed_at, a.created_at, k.key_id, k.public_key
    FROM accounts a JOIN account_keys k ON k.account_id = a.id
    WHERE a.id = $1 AND k.created_at = (SELECT MAX(created_at) FROM account_keys WHERE account_id = a.id)
  `, [id]);
  return rows[0] ?? null;
}

// --- sessions ---

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function createSession(accountId: string, client?: PoolClient): Promise<string> {
  const token = newSessionToken();
  const run = client ?? pool;
  await run.query('INSERT INTO sessions (token_hash, account_id, created_at) VALUES ($1,$2,$3)', [tokenHash(token), accountId, now()]);
  return token;
}

export async function accountForSession(token: string): Promise<AccountRecord | null> {
  if (!token) return null;
  const rows = await query<AccountRecord & { key_id: string; public_key: string }>(`
    SELECT a.id, a.username, a.read_receipts, a.preview, a.profile_iv, a.profile_ciphertext, a.profile_photo_blob_id,
           a.username_changed_at, a.created_at, k.key_id, k.public_key
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    JOIN account_keys k ON k.account_id = a.id
    WHERE s.token_hash = $1
      AND k.created_at = (SELECT MAX(created_at) FROM account_keys WHERE account_id = a.id)
  `, [tokenHash(token)]);
  return rows[0] ?? null;
}

export async function revokeOtherSessions(accountId: string, keepToken: string): Promise<void> {
  await query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, tokenHash(keepToken)]);
}

// --- recovery ---

export class RecoveryFailedError extends Error {}
export class TooManyAttemptsError extends Error {}

export interface RecoverInput {
  username: string;
  recovery_verifier: string;
  public_key: string;
  key_backup: { iv: string; ciphertext: string };
}

export interface RecoverResultDb {
  account: AccountRecord;
  key_backups: Array<{ key_id: string; iv: string; ciphertext: string; created_at: Date }>;
  sessionToken: string;
  revokedAccountIds: string[];
}

export async function recoverAccount(input: RecoverInput): Promise<RecoverResultDb> {
  const username = input.username.toLowerCase();
  const account = await accountByUsername(username);
  const attemptedAt = now();
  const recent = await query<{ count: string; first: Date | null }>(
    `SELECT COUNT(*) AS count, MIN(attempted_at) AS first FROM recovery_attempts
     WHERE username = $1 AND success = FALSE AND attempted_at > $2`,
    [username, new Date(attemptedAt.getTime() - RETRY_WINDOW_SECONDS * 1000)],
  );
  if (Number(recent[0].count) >= MAX_ATTEMPTS) {
    throw new TooManyAttemptsError();
  }

  let verifierMatches = false;
  if (account) {
    const rows = await query<{ salt: string; verifier_hash: string }>('SELECT salt, verifier_hash FROM recovery WHERE account_id = $1', [account.id]);
    const expected = Buffer.from(rows[0].verifier_hash, 'base64url');
    const actual = Buffer.from(hashVerifier(input.recovery_verifier, rows[0].salt), 'base64url');
    verifierMatches = expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  await query('INSERT INTO recovery_attempts (username, attempted_at, success) VALUES ($1,$2,$3)', [username, attemptedAt, verifierMatches]);

  if (!account || !verifierMatches) throw new RecoveryFailedError();

  return withTransaction(async (client) => {
    const keyId = await keyIdOf(input.public_key);
    const existingKey = await txQuery<{ key_id: string }>(client, 'SELECT key_id FROM account_keys WHERE account_id = $1 AND key_id = $2', [account.id, keyId]);
    if (existingKey.length === 0) {
      await txQuery(client, 'INSERT INTO account_keys (key_id, account_id, public_key, created_at) VALUES ($1,$2,$3,$4)',
        [keyId, account.id, input.public_key, now()]);
    }
    await txQuery(client, 'INSERT INTO key_backups (key_id, account_id, iv, ciphertext, created_at) VALUES ($1,$2,$3,$4,$5)',
      [keyId, account.id, input.key_backup.iv, input.key_backup.ciphertext, now()]);
    const token = await createSession(account.id, client);
    const backups = await txQuery<{ key_id: string; iv: string; ciphertext: string; created_at: Date }>(client,
      'SELECT key_id, iv, ciphertext, created_at FROM key_backups WHERE account_id = $1 ORDER BY created_at ASC, key_id ASC', [account.id]);
    const restored = await fetchAccountInTx(client, account.id);
    const otherSessions = await txQuery<{ token_hash: string }>(client, 'SELECT token_hash FROM sessions WHERE account_id = $1 AND token_hash <> $2', [account.id, tokenHash(token)]);
    await txQuery(client, 'DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [account.id, tokenHash(token)]);
    return { account: restored!, key_backups: backups, sessionToken: token, revokedAccountIds: otherSessions.map(() => account.id) };
  });
}

// --- username change ---

export async function changeUsername(account: AccountRecord, input: string): Promise<AccountRecord> {
  return withTransaction(async (client) => {
    const current = await txQuery<{ username: string; username_changed_at: Date | null }>(
      client, 'SELECT username, username_changed_at FROM accounts WHERE id = $1 FOR UPDATE', [account.id]);
    if (current.length === 0) throw new Error('account missing');
    const target = input.toLowerCase();
    if (target === current[0].username.toLowerCase()) throw new SameUsernameError();
    if (current[0].username_changed_at) {
      const retryAt = new Date(current[0].username_changed_at.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 3600 * 1000);
      if (retryAt.getTime() > now().getTime()) throw new UsernameCooldownError(retryAt);
    }
    const claim = await claimable(target, client);
    if (claim === 'taken') throw new UsernameTakenError();
    if (claim) throw new UsernameInvalidError(claim);
    await txQuery(client, 'UPDATE accounts SET username = $2, username_changed_at = $3 WHERE id = $1',
      [account.id, target, now()]);
    await txQuery(client, 'INSERT INTO name_holds (username, held_until) VALUES ($1,$2) ON CONFLICT (username) DO UPDATE SET held_until = EXCLUDED.held_until',
      [current[0].username.toLowerCase(), new Date(now().getTime() + NAME_HOLD_DAYS * 24 * 3600 * 1000)]);
    const restored = await fetchAccountInTx(client, account.id);
    return restored!;
  });
}

// --- settings ---

export async function updateSettings(accountId: string, patch: { read_receipts?: boolean; preview?: 'name_and_letter' | 'name_only' | 'none' }): Promise<AccountRecord> {
  await withTransaction(async (client) => {
    if (patch.read_receipts !== undefined) {
      await txQuery(client, 'UPDATE accounts SET read_receipts = $2 WHERE id = $1', [accountId, patch.read_receipts]);
    }
    if (patch.preview !== undefined) {
      await txQuery(client, 'UPDATE accounts SET preview = $2 WHERE id = $1', [accountId, patch.preview]);
    }
  });
  return (await accountById(accountId))!;
}

// --- profile ---

export async function updateProfile(accountId: string, profile: { iv: string; ciphertext: string; photo_blob_id: string | null }): Promise<AccountRecord> {
  await query('UPDATE accounts SET profile_iv = $2, profile_ciphertext = $3, profile_photo_blob_id = $4 WHERE id = $1',
    [accountId, profile.iv, profile.ciphertext, profile.photo_blob_id]);
  return (await accountById(accountId))!;
}

// Shared conversation check used by the profile rule.
export async function sharesAcceptedConversation(viewerId: string, otherId: string): Promise<boolean> {
  const rows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count FROM conversations c
    JOIN conversation_sides mine ON mine.conversation_id = c.id AND mine.account_id = $1
    JOIN conversation_sides theirs ON theirs.conversation_id = c.id AND theirs.account_id = $2
    WHERE (c.starter_id = $1 AND c.recipient_id = $2) OR (c.starter_id = $2 AND c.recipient_id = $1)
  `, [viewerId, otherId]);
  return Number(rows[0].count) > 0;
}
