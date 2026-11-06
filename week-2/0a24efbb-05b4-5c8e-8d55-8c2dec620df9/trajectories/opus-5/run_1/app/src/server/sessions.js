import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';
import { sessionEnded, signedOut } from './errors.js';
import { personById } from './people.js';

const SIGNED_OUT = 'signed_out';

function hash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Starts a fresh session. The identifier is always the desk's own, and any session the
 * sign-in request presented ends at once.
 */
export async function startSession(personId, presentedToken) {
  if (presentedToken) await endSessionByToken(presentedToken, 'replaced');
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await pool.query(
    'INSERT INTO app_session (token_hash, person_id, created_at, last_used_at) VALUES ($1, $2, $3, $3)',
    [hash(token), personId, now],
  );
  return token;
}

export async function endSessionByToken(token, reason = SIGNED_OUT) {
  await pool.query(
    'UPDATE app_session SET ended_at = now(), ended_reason = $2 WHERE token_hash = $1 AND ended_at IS NULL',
    [hash(token), reason],
  );
}

/**
 * The one session-expiry and renewal rule. Returns the live caller, or the refusal
 * that names why the session no longer counts.
 */
export async function readSession(token) {
  if (!token) return { failure: signedOut() };
  const result = await pool.query(
    'SELECT token_hash, person_id, created_at, last_used_at, ended_at, ended_reason FROM app_session WHERE token_hash = $1',
    [hash(token)],
  );
  const session = result.rows[0];
  if (!session) return { failure: signedOut() };
  if (session.ended_at) {
    return { failure: session.ended_reason === SIGNED_OUT ? signedOut() : sessionEnded() };
  }

  const now = Date.now();
  const idlePast = now - session.last_used_at.getTime() >= config.sessionIdleSeconds * 1000;
  const absolutePast = now - session.created_at.getTime() >= config.sessionMaxSeconds * 1000;
  if (idlePast || absolutePast) {
    await endSessionByToken(token, 'expired');
    return { failure: sessionEnded() };
  }

  const person = await personById(session.person_id);
  if (!person || !person.active) {
    await endSessionByToken(token, 'inactive');
    return { failure: sessionEnded() };
  }

  await pool.query('UPDATE app_session SET last_used_at = now() WHERE token_hash = $1', [session.token_hash]);
  return { person };
}
