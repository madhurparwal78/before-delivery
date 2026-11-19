import crypto from 'node:crypto';
import pg from 'pg';

export function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(12).toString('base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function constantTimeCompare(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Sign-in lock: LOGIN_MAX_FAILS refused sign-ins lock the account for LOCKOUT_SEC
// seconds since the last refusal. Both values come from the environment.
export function lockConfig() {
  const maxFails = parseInt(process.env.LOGIN_MAX_FAILS, 10);
  const lockoutSec = parseInt(process.env.LOCKOUT_SEC, 10);
  return {
    maxFails: Number.isFinite(maxFails) && maxFails > 0 ? maxFails : Infinity,
    lockoutSec: Number.isFinite(lockoutSec) && lockoutSec > 0 ? lockoutSec : Infinity,
  };
}

export function chatRateLimit() {
  const n = parseInt(process.env.CHAT_RATE_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

export function firstMoveAbortSec() {
  const n = parseInt(process.env.FIRST_MOVE_ABORT_SEC, 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

export function moveDeadlineSec() {
  const n = parseInt(process.env.MOVE_DEADLINE_SEC, 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}
