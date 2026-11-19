/**
 * Every value the deployment supplies.  Nothing here carries a literal
 * fallback: a missing setting stops the app with a readable message rather
 * than baking a number into the source.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} is not set in the environment`);
  }
  return String(value).trim();
}

function requiredNumber(name) {
  const value = Number(required(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: requiredNumber('APP_PUBLIC_PORT'),
  host: '0.0.0.0',
  publicUrl: required('APP_PUBLIC_URL'),
  loginMaxFails: requiredNumber('LOGIN_MAX_FAILS'),
  lockoutSec: requiredNumber('LOCKOUT_SEC'),
  chatRateLimit: requiredNumber('CHAT_RATE_LIMIT'),
  firstMoveAbortSec: requiredNumber('FIRST_MOVE_ABORT_SEC'),
  moveDeadlineSec: requiredNumber('MOVE_DEADLINE_SEC'),
};

export const DEMO_PASSWORD = 'gambit-demo-pw-2026';
