function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a whole number of seconds from ${min} to ${max}`);
  }
  return parsed;
}

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);

export const env = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
  },
  mailFrom: required('MAIL_FROM'),
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  holdTtlSeconds: seconds('HOLD_TTL_SECONDS', 480, 1, 3600),
  stepupCodeTtlSeconds: seconds('STEPUP_CODE_TTL_SECONDS', 600, 1, 3600),
  stepupValidSeconds: seconds('STEPUP_VALID_SECONDS', 600, 1, 3600),
  stepupLockoutSeconds: seconds('STEPUP_LOCKOUT_SECONDS', 900, 1, 86400),
} as const;

export const mailFromAddress = /<([^>]+)>/.exec(env.mailFrom)?.[1] ?? env.mailFrom;
export const mailFromDomain = mailFromAddress.split('@')[1] ?? 'localhost';
