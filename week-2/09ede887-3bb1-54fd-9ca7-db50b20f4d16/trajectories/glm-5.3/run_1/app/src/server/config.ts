/**
 * Settings from the environment, read once at start. No tunable value is
 * written into source as the deployed value, and none but `closes_at` and
 * `held_until` instants ever reach the browser.
 */

export interface Config {
  databaseUrl: string;
  port: number;
  signinThrottleWindowSeconds: number;
  idempotencyKeyTtlSeconds: number;
  holdSeconds: number;
  contestClosesAt: Date;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  const port = numberOr(env.APP_PUBLIC_PORT, 4173);
  const signinThrottleWindowSeconds = numberOr(env.SIGNIN_THROTTLE_WINDOW_SECONDS, 900);
  const idempotencyKeyTtlSeconds = numberOr(env.IDEMPOTENCY_KEY_TTL_SECONDS, 86400);
  const holdSeconds = numberOr(env.HOLD_SECONDS, 900);
  const closesRaw = env.CONTEST_CLOSES_AT ?? '2026-10-31T16:00:00Z';
  const contestClosesAt = new Date(closesRaw);
  if (Number.isNaN(contestClosesAt.getTime())) {
    throw new Error('CONTEST_CLOSES_AT is not a valid ISO-8601 instant');
  }
  return {
    databaseUrl,
    port,
    signinThrottleWindowSeconds,
    idempotencyKeyTtlSeconds,
    holdSeconds,
    contestClosesAt,
  };
}

function numberOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
