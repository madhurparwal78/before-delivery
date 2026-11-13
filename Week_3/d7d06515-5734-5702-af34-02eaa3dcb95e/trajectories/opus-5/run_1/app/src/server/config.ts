function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`environment variable ${name} is not an integer`);
  return value;
}

const port = integer('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: process.env.MAIL_FROM ?? 'Corbel Draft <no-reply@corbelworks.example>',
  },
  valkeyUrl: required('VALKEY_URL'),
  gradingEnabled: (process.env.CORBEL_GRADING ?? 'on') !== 'off',
  verifyLinkSeconds: integer('VERIFY_LINK_SECONDS', 86400),
  signinMaxFailures: integer('SIGNIN_MAX_FAILURES', 5),
  signinLockSeconds: integer('SIGNIN_LOCK_SECONDS', 900),
  inviteCooldownSeconds: integer('INVITE_COOLDOWN_SECONDS', 60),
  presenceIdleSeconds: integer('PRESENCE_IDLE_SECONDS', 120),
  uploadMaxBytes: integer('UPLOAD_MAX_BYTES', 5_000_000),
  trialDays: integer('TRIAL_DAYS', 30),
  jsonMaxBytes: 1_000_000,
  sessionCookie: 'corbel_session',
  sessionDays: 30,
} as const;
