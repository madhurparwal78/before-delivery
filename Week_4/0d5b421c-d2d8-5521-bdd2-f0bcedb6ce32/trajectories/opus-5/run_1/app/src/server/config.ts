function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  valkeyKeyPrefix: optional('VALKEY_KEY_PREFIX', ''),
  killbillUrl: required('KILLBILL_URL'),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailFrom: required('MAIL_FROM'),
  holdSeconds: integer('HOLD_SECONDS', 300),
  offerSeconds: integer('OFFER_SECONDS', 900),
  clockControl: optional('APP_CLOCK_CONTROL', '') === '1',
  port: integer('APP_PUBLIC_PORT', 4173),
  publicUrl: optional(
    'APP_PUBLIC_URL',
    `http://127.0.0.1:${integer('APP_PUBLIC_PORT', 4173)}`,
  ).replace(/\/+$/, ''),
} as const;

export type Config = typeof config;
