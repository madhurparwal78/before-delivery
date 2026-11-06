export interface Settings {
  readonly databaseUrl: string;
  readonly port: number;
  readonly signinThrottleWindowSeconds: number;
  readonly idempotencyKeyTtlSeconds: number;
  readonly holdSeconds: number;
  readonly contestClosesAt: string;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

function instant(name: string, fallback: string): string {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be an ISO-8601 instant`);
  }
  return parsed.toISOString();
}

export function readSettings(): Settings {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }
  return {
    databaseUrl: databaseUrl.trim(),
    port: wholeNumber('APP_PUBLIC_PORT', 4173),
    signinThrottleWindowSeconds: wholeNumber('SIGNIN_THROTTLE_WINDOW_SECONDS', 900),
    idempotencyKeyTtlSeconds: wholeNumber('IDEMPOTENCY_KEY_TTL_SECONDS', 86400),
    holdSeconds: wholeNumber('HOLD_SECONDS', 900),
    contestClosesAt: instant('CONTEST_CLOSES_AT', '2026-10-31T16:00:00Z'),
  };
}
