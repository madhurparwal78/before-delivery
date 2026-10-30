'use strict';
// Sign-in, password hashing, bearer tokens and the sign-in throttle. A token is 32
// random bytes; only its SHA-256 is stored. The role is never carried in the token:
// every request reads it from the stored member.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { query, tx } = require('./db');
const config = require('./config');
const { refuse } = require('./messages');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const FAILURES_TO_LOCK = 5;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

// An unknown email is checked against a fixed hash, so both refusals cost the same.
const UNKNOWN_HASH = `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;

async function passwordMatches(password, stored) {
  const [, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const publicMember = (row) => ({ id: row.id, name: row.name, email: row.email, role: row.role });

// Seconds until the address has fewer than five counted failures, or 0 when it is
// not throttled. Counted failures sit inside the window and after the latest success.
async function lockoutSeconds(client, email) {
  const { rows } = await client.query(
    `SELECT ceil(extract(epoch FROM f.created_at + make_interval(secs => $2) - clock_timestamp()))::int AS wait
     FROM sign_in_attempts f
     WHERE f.email = $1 AND NOT f.succeeded
       AND f.created_at > clock_timestamp() - make_interval(secs => $2)
       AND f.created_at > coalesce((SELECT max(created_at) FROM sign_in_attempts
                                    WHERE email = $1 AND succeeded), '-infinity')
     ORDER BY f.created_at DESC OFFSET $3 - 1 LIMIT 1`,
    [email, config.lockoutSeconds, FAILURES_TO_LOCK]);
  return rows.length ? Math.max(1, rows[0].wait) : 0;
}

// Exchange an email and password for a new session. Attempts on one address are
// serialized so the count and the decision always agree.
async function signIn(rawEmail, password) {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!email) throw refuse.invalidCredentials();
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4173002, hashtext($1))', [email]);
    const wait = await lockoutSeconds(c, email);
    if (wait) throw refuse.rateLimited(wait);
    const { rows } = await c.query('SELECT id, name, email, role, password_hash FROM members WHERE email = $1',
      [email]);
    const member = rows[0];
    const ok = typeof password === 'string'
      && await passwordMatches(password, member ? member.password_hash : UNKNOWN_HASH) && Boolean(member);
    await c.query('INSERT INTO sign_in_attempts (email, succeeded) VALUES ($1, $2)', [email, ok]);
    if (!ok) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    await c.query('INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)', [tokenHash(token), member.id]);
    return { token, user: publicMember(member) };
  }).then((session) => {
    // The failed attempt is committed before the refusal is raised.
    if (!session) throw refuse.invalidCredentials();
    return session;
  });
}

async function memberForToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT m.id, m.name, m.email, m.role FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`, [tokenHash(token)]);
  return rows[0] ? publicMember(rows[0]) : null;
}

async function signOut(token) {
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash(token)]);
}

module.exports = { hashPassword, signIn, signOut, memberForToken };
