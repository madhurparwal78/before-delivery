// The one place the server reads its environment. Values are read once, at start.

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} must be set`);
}

function wholeNumber(name: string, fallback: string): number {
  const raw = text(name, fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive whole number`);
  return value;
}

function instant(name: string, fallback: string): Date {
  const raw = text(name, fallback);
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) throw new Error(`${name} must be an ISO-8601 instant`);
  return value;
}

export const config = {
  databaseUrl: text('DATABASE_URL'),
  port: wholeNumber('APP_PUBLIC_PORT', '4173'),
  signinThrottleWindowSeconds: wholeNumber('SIGNIN_THROTTLE_WINDOW_SECONDS', '900'),
  idempotencyKeyTtlSeconds: wholeNumber('IDEMPOTENCY_KEY_TTL_SECONDS', '86400'),
  holdSeconds: wholeNumber('HOLD_SECONDS', '900'),
  contestClosesAt: instant('CONTEST_CLOSES_AT', '2026-10-31T16:00:00Z'),
} as const;
