'use strict';

// Sessions, sign-in refusal and lockout. Emails are trimmed and lowercased
// before every comparison, and failures live in the database so a restart
// keeps them.

const crypto = require('crypto');
const db = require('./db');
const clock = require('./clock');
const passwords = require('./passwords');

const LOCKOUT_FAILURES = 5;

function lockoutWindowSeconds() {
  const raw = Number(process.env.LOGIN_LOCKOUT_WINDOW_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 900;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(client, userId, companyId) {
  const token = newToken();
  await client.query(
    'INSERT INTO sessions (id, token_hash, user_id, company_id, created_at) VALUES ($1, $2, $3, $4, $5)',
    [db.newId(), tokenHash(token), userId, companyId, clock.now()]
  );
  return token;
}

async function resolveSession(token) {
  if (!token || typeof token !== 'string') return null;
  const result = await db.query(
    `SELECT s.id AS session_id, s.token_hash, u.id AS user_id, u.email, u.name,
            m.company_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.company_id = s.company_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash(token)]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    companyId: row.company_id,
    role: row.role,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      company_id: row.company_id,
    },
  };
}

async function revokeSession(sessionId) {
  await db.query('UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL', [
    clock.now(),
    sessionId,
  ]);
}

// One sign-in attempt at a time per email, counted in the database.
async function attemptLogin(email, password) {
  const userResult = await db.query(
    'SELECT id, email, name, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = userResult.rows[0] || null;
  // An unknown email performs the same password-hash work as a wrong password.
  const passwordOk = await passwords.verifyPassword(
    password,
    user ? user.password_hash : passwords.DECOY_HASH
  );

  return db.transaction(async (client) => {
    await client.query(
      'INSERT INTO login_attempt_locks (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email]
    );
    await client.query('SELECT email FROM login_attempt_locks WHERE email = $1 FOR UPDATE', [email]);

    const since = new Date(clock.nowMs() - lockoutWindowSeconds() * 1000);
    const failures = await client.query(
      'SELECT count(*)::int AS n FROM login_failures WHERE email = $1 AND created_at > $2',
      [email, since]
    );
    if (failures.rows[0].n >= LOCKOUT_FAILURES) return { outcome: 'locked' };

    if (!passwordOk || !user) {
      await client.query(
        'INSERT INTO login_failures (id, email, created_at) VALUES ($1, $2, $3)',
        [db.newId(), email, clock.now()]
      );
      return { outcome: 'invalid' };
    }

    await client.query('DELETE FROM login_failures WHERE email = $1', [email]);
    const membership = await client.query(
      'SELECT company_id, role FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1',
      [user.id]
    );
    if (membership.rows.length === 0) return { outcome: 'invalid' };
    const token = await createSession(client, user.id, membership.rows[0].company_id);
    return {
      outcome: 'ok',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.rows[0].role,
        company_id: membership.rows[0].company_id,
      },
    };
  });
}

module.exports = {
  LOCKOUT_FAILURES,
  lockoutWindowSeconds,
  tokenHash,
  createSession,
  resolveSession,
  revokeSession,
  attemptLogin,
};
