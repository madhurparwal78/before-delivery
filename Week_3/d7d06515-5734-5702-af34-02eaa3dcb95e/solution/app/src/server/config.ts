// Every environment variable the server reads, read once at start. Nothing else touches process.env.

function text(name: string): string {
  return process.env[name] ?? '';
}

function whole(name: string, fallback: number): number {
  const value = Number.parseInt(text(name), 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: (text('APP_PUBLIC_URL') || `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: text('SMTP_HOST'),
    port: whole('SMTP_PORT', 25),
    from: text('MAIL_FROM'),
  },
  valkeyUrl: text('VALKEY_URL'),
  grading: text('CORBEL_GRADING') !== 'off',
  verifyLinkSeconds: whole('VERIFY_LINK_SECONDS', 86400),
  signinMaxFailures: whole('SIGNIN_MAX_FAILURES', 5),
  signinLockSeconds: whole('SIGNIN_LOCK_SECONDS', 900),
  inviteCooldownSeconds: whole('INVITE_COOLDOWN_SECONDS', 60),
  presenceIdleSeconds: whole('PRESENCE_IDLE_SECONDS', 120),
  uploadMaxBytes: whole('UPLOAD_MAX_BYTES', 5000000),
  trialDays: whole('TRIAL_DAYS', 30),
  /** Published limit for JSON bodies; equal is allowed. */
  jsonMaxBytes: 1000000,
} as const;
