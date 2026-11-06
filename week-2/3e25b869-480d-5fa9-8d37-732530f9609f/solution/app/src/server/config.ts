// The only reader of process.env: every credential, address and duration the server uses.
import { randomBytes } from 'node:crypto';

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`environment variable ${name} is required`);
}

function integer(name: string, fallback: number | null, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback === null) throw new Error(`environment variable ${name} is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

const mailFrom = text('MAIL_FROM');
const fromAddress = /<([^<>]+)>/.exec(mailFrom)?.[1] ?? mailFrom.trim();

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173, 1, 65535),
  databaseUrl: text('DATABASE_URL'),
  killbill: {
    url: text('KILLBILL_URL').replace(/\/+$/, ''),
    username: text('KILLBILL_USERNAME'),
    password: text('KILLBILL_PASSWORD'),
    apiKey: text('KILLBILL_API_KEY'),
    apiSecret: text('KILLBILL_API_SECRET'),
  },
  smtp: { host: text('SMTP_HOST'), port: integer('SMTP_PORT', null, 1, 65535) },
  mail: {
    from: mailFrom,
    fromAddress,
    domain: fromAddress.slice(fromAddress.indexOf('@') + 1),
  },
  holdTtlSeconds: integer('HOLD_TTL_SECONDS', 600, 10, 3600),
  stepup: {
    codeTtlSeconds: integer('STEPUP_CODE_TTL_SECONDS', 300),
    lockSeconds: integer('STEPUP_LOCK_SECONDS', 900),
    rateLimit: integer('STEPUP_RATE_LIMIT', 3),
    rateWindowSeconds: integer('STEPUP_RATE_WINDOW_SECONDS', 600),
  },
  subscriptionLockHours: integer('SUBSCRIPTION_LOCK_HOURS', 48, 0),
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
} as const;
