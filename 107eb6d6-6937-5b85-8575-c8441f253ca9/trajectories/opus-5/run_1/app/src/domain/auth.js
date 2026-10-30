import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { query } from '../db.js';
import { invalidCredentials, rateLimited } from './errors.js';

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return timingSafeEqual(expected, actual);
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export const publicMember = ({ id, name, email, role }) => ({ id, name, email, role });

async function throttleState(email) {
  const { rows } = await query(
    `WITH last_success AS (
       SELECT max(created_at) AS at FROM sign_in_attempts WHERE email = $1 AND succeeded
     ),
     counted AS (
       SELECT a.created_at
       FROM sign_in_attempts a, last_success s
       WHERE a.email = $1
         AND NOT a.succeeded
         AND a.created_at > now() - make_interval(secs => $2)
         AND (s.at IS NULL OR a.created_at > s.at)
       ORDER BY a.created_at DESC
     )
     SELECT
       (SELECT count(*) FROM counted)::int AS failures,
       (SELECT ceil(extract(epoch FROM (created_at + make_interval(secs => $2) - now())))::int
          FROM counted OFFSET $3 - 1 LIMIT 1) AS seconds_left`,
    [email, config.signInLockoutSeconds, config.maxFailedSignIns]
  );
  const { failures, seconds_left: secondsLeft } = rows[0];
  return {
    locked: failures >= config.maxFailedSignIns,
    retryAfter: Math.min(config.signInLockoutSeconds, Math.max(1, secondsLeft ?? 1))
  };
}

export async function signIn({ email, password }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const throttle = await throttleState(normalizedEmail);
  if (throttle.locked) throw rateLimited(throttle.retryAfter);

  const { rows } = await query('SELECT id, name, email, role, password_hash FROM members WHERE email = $1', [
    normalizedEmail
  ]);
  const member = rows[0];
  const succeeded = Boolean(
    member && typeof password === 'string' && (await verifyPassword(password, member.password_hash))
  );
  await query('INSERT INTO sign_in_attempts (email, succeeded) VALUES ($1, $2)', [normalizedEmail, succeeded]);
  if (!succeeded) throw invalidCredentials();

  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)', [tokenHash(token), member.id]);
  return { token, user: publicMember(member) };
}

export async function memberForToken(token) {
  const { rows } = await query(
    `SELECT m.id, m.name, m.email, m.role
     FROM sessions s
     JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash(token ?? '')]
  );
  return rows[0] ?? null;
}

export async function signOut(token) {
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    tokenHash(token)
  ]);
}
