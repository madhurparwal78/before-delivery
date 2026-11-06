function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
  },
  port: integer('APP_PUBLIC_PORT', 4173),
  holdTtlSeconds: integer('HOLD_TTL_SECONDS', 600),
  reminderSweepSeconds: integer('REMINDER_SWEEP_SECONDS', 60),
} as const;
