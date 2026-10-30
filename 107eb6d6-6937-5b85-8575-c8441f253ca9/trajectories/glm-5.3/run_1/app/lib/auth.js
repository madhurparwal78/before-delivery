'use strict';

const crypto = require('crypto');
const { LOCKOUT_SECONDS, INVALID_CREDENTIALS, LOCKED_OUT } = require('./domain');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, digest] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(digest, 'hex'));
  } catch {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function memberForToken(client, token) {
  if (!token) return null;
  const { rows } = await client.query(
    `SELECT m.id, m.name, m.email, m.role
     FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash(token)],
  );
  return rows[0] || null;
}

// Rule 15 in one place: counted failures are the failures inside the lockout
// window that are newer than the address's latest success. Retry-After is the
// time until the address is back under five of them.
async function countedFailureState(client, email, lockoutSeconds) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM sign_in_attempts a
        WHERE a.email = $1 AND a.succeeded = false AND a.created_at > now() - ($2 || ' seconds')::interval
          AND a.created_at >
              COALESCE((SELECT max(b.created_at) FROM sign_in_attempts b
                        WHERE b.email = $1 AND b.succeeded = true), '-infinity')) AS failures,
       (SELECT min(created_at) FROM (
          SELECT a.created_at FROM sign_in_attempts a
          WHERE a.email = $1 AND a.succeeded = false AND a.created_at > now() - ($2 || ' seconds')::interval
            AND a.created_at >
                COALESCE((SELECT max(b.created_at) FROM sign_in_attempts b
                          WHERE b.email = $1 AND b.succeeded = true), '-infinity')
          ORDER BY a.created_at DESC LIMIT 5) fifth) AS fifth_failure_at`,
    [email, String(lockoutSeconds)],
  );
  const failures = Number(rows[0].failures);
  if (failures < 5) return { failures, retryAfter: null };
  const elapsed = (Date.now() - new Date(rows[0].fifth_failure_at).getTime()) / 1000;
  const seconds = Math.ceil(lockoutSeconds - elapsed);
  return { failures, retryAfter: Math.min(lockoutSeconds, Math.max(1, seconds)) };
}

async function login(pool, email, password) {
  const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const lockout = LOCKOUT_SECONDS();
  return pool.connect().then(async (client) => {
    try {
      const { failures, retryAfter } = await countedFailureState(client, trimmed, lockout);
      if (failures >= 5) {
        return { status: 429, body: LOCKED_OUT, retryAfter };
      }
      let member = null;
      if (trimmed) {
        const { rows } = await client.query('SELECT * FROM members WHERE email = $1', [trimmed]);
        member = rows[0] || null;
      }
      const ok = member && verifyPassword(password || '', member.password_hash);
      await client.query('INSERT INTO sign_in_attempts (email, succeeded, created_at) VALUES ($1,$2,now())', [trimmed, Boolean(ok)]);
      if (!ok) return { status: 401, body: INVALID_CREDENTIALS };
      const token = newToken();
      await client.query('INSERT INTO sessions (token_hash, member_id) VALUES ($1,$2)', [tokenHash(token), member.id]);
      return {
        status: 200,
        token,
        user: { id: member.id, name: member.name, email: member.email, role: member.role },
      };
    } finally {
      client.release();
    }
  });
}

async function logout(pool, token) {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash(token)]);
}

module.exports = { hashPassword, verifyPassword, memberForToken, login, logout, newToken };
