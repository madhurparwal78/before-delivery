import { randomBytes } from 'node:crypto';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173, 1, 65_535),
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: { host: required('SMTP_HOST'), port: integer('SMTP_PORT', 1025, 1, 65_535) },
  mailFrom: required('MAIL_FROM'),
  holdTtlSeconds: integer('HOLD_TTL_SECONDS', 600, 10, 3_600),
  stepupCodeTtlSeconds: integer('STEPUP_CODE_TTL_SECONDS', 300, 1, 86_400),
  stepupLockSeconds: integer('STEPUP_LOCK_SECONDS', 900, 1, 86_400),
  stepupRateLimit: integer('STEPUP_RATE_LIMIT', 3, 1, 1_000),
  stepupRateWindowSeconds: integer('STEPUP_RATE_WINDOW_SECONDS', 600, 1, 86_400),
  subscriptionLockHours: integer('SUBSCRIPTION_LOCK_HOURS', 48, 0, 24 * 60),
  sessionSecret: process.env['SESSION_SECRET'] || randomBytes(32).toString('hex'),
} as const;

/** Sizes and windows that the brief fixes rather than reading from the environment. */
export const LIMITS = {
  maxBodyBytes: 65_536,
  sessionSeconds: 12 * 60 * 60,
  idempotencySeconds: 24 * 60 * 60,
  killbillTimeoutMs: 5_000,
  holdsPerCartPerBatch: 2,
  stepupMaxFailures: 5,
  noticeRetryDelaysMs: [5_000, 15_000, 45_000],
  noticeMaxAttempts: 4,
  monitorIntervalMs: 5_000,
  catalogRetryMs: 10_000,
} as const;
