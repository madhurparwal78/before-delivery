const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function num(name: string, def: number): number {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const port = env.APP_PUBLIC_PORT ? Math.floor(Number(env.APP_PUBLIC_PORT)) : 4173;

export const config = {
  port: Number.isFinite(port) && port > 0 ? port : 4173,
  databaseUrl: required('DATABASE_URL'),
  publicBaseUrl:
    env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL !== ''
      ? env.PUBLIC_BASE_URL.replace(/\/$/, '')
      : env.APP_PUBLIC_URL && env.APP_PUBLIC_URL !== ''
        ? env.APP_PUBLIC_URL.replace(/\/$/, '')
        : `http://localhost:${port}`,
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: env.S3_REGION || 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: env.SMTP_PORT ? Math.floor(Number(env.SMTP_PORT)) : 25,
  },
  mailFrom: env.MAIL_FROM || 'Aldermoor Open Record <record@aldermoor.example>',
  outboxRetrySeconds: num('OUTBOX_RETRY_SECONDS', 10),
  outboxRetryMaxSeconds: num('OUTBOX_RETRY_MAX_SECONDS', 60),
  jobMaxAttempts: num('JOB_MAX_ATTEMPTS', 5),
  applicationRetentionSeconds: num('APPLICATION_RETENTION_SECONDS', 15552000),
  resendWindowSeconds: num('RESEND_WINDOW_SECONDS', 3600),
  sessionTtlSeconds: num('SESSION_TTL_SECONDS', 43200),
  signinLockoutSeconds: num('SIGNIN_LOCKOUT_SECONDS', 30),
  idempotencyTtlSeconds: num('IDEMPOTENCY_TTL_SECONDS', 86400),
  rateLimit: {
    public: num('RATE_LIMIT_PUBLIC_PER_MINUTE', 600),
    candidate: num('RATE_LIMIT_CANDIDATE_PER_MINUTE', 60),
    signin: num('RATE_LIMIT_SIGNIN_PER_MINUTE', 20),
    consoleWrites: num('RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE', 120),
  },
  trustForwardedFor: env.TRUST_FORWARDED_FOR === 'true',
  storageTimeoutMs: 3000,
  probeIntervalMs: 5000,
  dbRetryMs: 2000,
};

export type AppConfig = typeof config;
