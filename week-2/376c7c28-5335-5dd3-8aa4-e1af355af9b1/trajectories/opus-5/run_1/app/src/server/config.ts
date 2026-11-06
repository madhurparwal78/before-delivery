function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw !== undefined && raw !== '') return raw;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function int(name: string, fallback: number, max?: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? fallback : Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return max !== undefined ? Math.min(value, max) : value;
}

export const config = {
  port: int('APP_PUBLIC_PORT', 4173),
  databaseUrl: str('DATABASE_URL'),
  sessionTtlSeconds: int('SESSION_TTL_SECONDS', 43_200),
  inviteTtlSeconds: int('INVITE_TTL_SECONDS', 604_800),
  signinLockSeconds: int('SIGNIN_LOCK_SECONDS', 900),
  billingRetrySeconds: int('BILLING_RETRY_SECONDS', 15, 60),
  reminderSweepSeconds: int('REMINDER_SWEEP_SECONDS', 60, 60),
  clockStart: process.env['APP_CLOCK_START'] ?? '',
  killbill: {
    url: str('KILLBILL_URL'),
    username: str('KILLBILL_USERNAME'),
    password: str('KILLBILL_PASSWORD'),
    apiKey: str('KILLBILL_API_KEY'),
    apiSecret: str('KILLBILL_API_SECRET'),
  },
  s3: {
    endpoint: str('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Kiln Desk <desk@kilndesk.example>'),
  },
} as const;
