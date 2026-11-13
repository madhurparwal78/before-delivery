import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { hueForUserId } from '../../shared/hue.js';
import type { Me, User } from '../../shared/types.js';
import { query, queryOne } from '../db.js';
import { validationFailed } from '../errors.js';

export const SESSION_COOKIE = 'pc_session';

const SCRYPT_KEYLEN = 64;

export interface UserRow {
  id: number;
  email: string;
  handle: string;
  email_verified: boolean;
}

interface CredentialRow extends UserRow {
  password_hash: string;
}

export function toUser(row: Pick<UserRow, 'id' | 'handle'>): User {
  return { id: row.id, handle: row.handle, hue: hueForUserId(row.id) };
}

export function toMe(row: UserRow): Me {
  return { ...toUser(row), email: row.email, emailVerified: row.email_verified };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export const FIELD_COPY = {
  email: 'Enter a valid email address.',
  handle: 'Use 3 to 20 lowercase letters, digits or underscores.',
  password: 'Use 10 to 128 characters.',
} as const;

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function normaliseHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const handle = value.trim().toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length >= 10 && value.length <= 128 ? value : null;
}

export interface SignupInput {
  email: string;
  handle: string;
  password: string;
}

export function validateSignup(body: Record<string, unknown>): SignupInput {
  const email = normaliseEmail(body.email);
  const handle = normaliseHandle(body.handle);
  const password = checkPassword(body.password);
  const fields: Record<string, string> = {};
  if (email === null) fields.email = FIELD_COPY.email;
  if (handle === null) fields.handle = FIELD_COPY.handle;
  if (password === null) fields.password = FIELD_COPY.password;
  if (email === null || handle === null || password === null) throw validationFailed(fields);
  return { email, handle, password };
}

export async function findByEmail(email: string): Promise<CredentialRow | null> {
  return queryOne<CredentialRow>(
    'SELECT id, email, handle, email_verified, password_hash FROM users WHERE email = $1',
    [email],
  );
}

export async function findByHandle(handle: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    'SELECT id, email, handle, email_verified FROM users WHERE handle = $1',
    [handle.toLowerCase()],
  );
}

export async function findById(id: number): Promise<UserRow | null> {
  return queryOne<UserRow>(
    'SELECT id, email, handle, email_verified FROM users WHERE id = $1',
    [id],
  );
}

export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const row = await findByEmail(email);
  if (row === null || !passwordMatches(password, row.password_hash)) return null;
  return row;
}

export async function setPassword(userId: number, password: string): Promise<void> {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    userId,
    hashPassword(password),
  ]);
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function markVerified(userId: number): Promise<void> {
  await query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
}

export async function createSession(userId: number): Promise<string> {
  const token = `${randomUUID()}.${randomBytes(24).toString('base64url')}`;
  await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function userForSession(token: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT u.id, u.email, u.handle, u.email_verified
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
}

export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}
