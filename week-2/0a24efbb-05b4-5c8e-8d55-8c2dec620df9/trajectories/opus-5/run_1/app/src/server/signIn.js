import { SIGN_IN_MAX_ATTEMPTS } from '../shared/constants.js';
import { refusals } from '../shared/copy.js';
import { foldWorkAddress } from '../shared/text.js';
import { config } from './config.js';
import { pool } from './db.js';
import { Refusal } from './errors.js';
import { personByFoldedAddress } from './people.js';
import { REALM_OK, REALM_UNREACHABLE, exchangePassword } from './realm.js';
import { startSession } from './sessions.js';

const WINDOW_MS = () => config.signInWindowSeconds * 1000;
const LOCKOUT_MS = () => config.signInLockoutSeconds * 1000;

/**
 * The one lockout rule. Every spelling of one address shares one count, and known,
 * unknown and deactivated addresses lock in exactly the same way.
 */
export async function lockoutState(foldedAddress, now = Date.now()) {
  const horizon = new Date(now - (WINDOW_MS() + LOCKOUT_MS()) * 3);
  const result = await pool.query(
    'SELECT attempted_at, succeeded FROM sign_in_attempt WHERE work_address = $1 AND attempted_at >= $2 ORDER BY attempted_at, id',
    [foldedAddress, horizon],
  );

  let refused = [];
  let lockUntil = null;
  for (const attempt of result.rows) {
    const at = attempt.attempted_at.getTime();
    if (lockUntil !== null) {
      if (at < lockUntil) continue;
      lockUntil = null;
      refused = [];
    }
    if (attempt.succeeded) {
      refused = [];
      continue;
    }
    refused = refused.filter((time) => time > at - WINDOW_MS());
    refused.push(at);
    if (refused.length >= SIGN_IN_MAX_ATTEMPTS) lockUntil = at + LOCKOUT_MS();
  }

  if (lockUntil !== null && now < lockUntil) {
    const secondsLeft = Math.min(config.signInLockoutSeconds, Math.max(1, Math.ceil((lockUntil - now) / 1000)));
    return { locked: true, retryAfter: secondsLeft };
  }
  return { locked: false };
}

async function recordAttempt(foldedAddress, succeeded) {
  await pool.query('INSERT INTO sign_in_attempt (work_address, attempted_at, succeeded) VALUES ($1, now(), $2)', [
    foldedAddress,
    succeeded,
  ]);
}

/**
 * Checks a work address and password, in the published order. Answers the session
 * token on success, or throws the one refusal that step reached.
 */
export async function signIn(workAddress, password, presentedToken) {
  const folded = foldWorkAddress(workAddress);

  const lock = await lockoutState(folded);
  if (lock.locked) {
    await recordAttempt(folded, false);
    throw new Refusal(429, refusals.signInLocked, { retryAfter: lock.retryAfter });
  }

  const exchange = await exchangePassword(folded, password);
  if (exchange.outcome === REALM_UNREACHABLE) {
    throw new Refusal(503, refusals.signInUnavailable);
  }

  const person = await personByFoldedAddress(folded);
  if (exchange.outcome !== REALM_OK || !person || !person.active) {
    await recordAttempt(folded, false);
    throw new Refusal(401, refusals.signInRefused);
  }

  await recordAttempt(folded, true);
  const token = await startSession(person.id, presentedToken);
  return { person, token };
}
