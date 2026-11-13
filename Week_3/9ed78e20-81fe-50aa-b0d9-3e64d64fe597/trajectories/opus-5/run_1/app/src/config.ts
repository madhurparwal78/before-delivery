function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a whole number`);
  }
  return parsed;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true';
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  databaseUrl: required('DATABASE_URL'),
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: flag('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Aldermoor Open Record <record@aldermoor.example>'),
  },
  port,
  publicBaseUrl: text('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  outboxRetrySeconds: whole('OUTBOX_RETRY_SECONDS', 10),
  outboxRetryMaxSeconds: whole('OUTBOX_RETRY_MAX_SECONDS', 60),
  jobMaxAttempts: whole('JOB_MAX_ATTEMPTS', 5),
  applicationRetentionSeconds: whole('APPLICATION_RETENTION_SECONDS', 15_552_000),
  resendWindowSeconds: whole('RESEND_WINDOW_SECONDS', 3600),
  sessionTtlSeconds: whole('SESSION_TTL_SECONDS', 43_200),
  signinLockoutSeconds: whole('SIGNIN_LOCKOUT_SECONDS', 30),
  idempotencyTtlSeconds: whole('IDEMPOTENCY_TTL_SECONDS', 86_400),
  rateLimits: {
    public: whole('RATE_LIMIT_PUBLIC_PER_MINUTE', 600),
    candidate: whole('RATE_LIMIT_CANDIDATE_PER_MINUTE', 60),
    signin: whole('RATE_LIMIT_SIGNIN_PER_MINUTE', 20),
    consoleWrites: whole('RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE', 120),
  },
  trustForwardedFor: flag('TRUST_FORWARDED_FOR', false),
} as const;
