/**
 * Passwords, session tokens and the opaque paging cursor.  The club's own
 * sessions: a username, a hashed password and a token, nothing bought in.
 */

import crypto from 'node:crypto';
import { config } from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// The cursor key is derived from the deployment's own settings, so a cursor
// this process issues is still honoured after a restart and one it never
// issued cannot be forged.
const cursorKey = crypto.createHash('sha256').update(`gambit-hall-cursor|${config.databaseUrl}`).digest();

export class BadCursor extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Encode paging state as a token carrying no readable offset. */
export function encodeCursor(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cursorKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64url');
}

export function decodeCursor(token) {
  if (token === undefined || token === null || token === '') return null;
  try {
    const raw = Buffer.from(String(token), 'base64url');
    if (raw.length < 29) throw new Error('short');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cursorKey, iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    return JSON.parse(text);
  } catch {
    throw new BadCursor('that cursor was never issued');
  }
}

/** A page size on the query string, defaulting to 50 and never above 100. */
export function pageLimit(value, fallback = 50, ceiling = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), ceiling);
}
