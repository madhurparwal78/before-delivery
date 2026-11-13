function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a whole number of seconds`);
  }
  return parsed;
}

export const config = {
  port: wholeSeconds('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gotenbergUrl: required('GOTENBERG_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
  },
  mailFrom: process.env.MAIL_FROM ?? 'Lowlamp Field Log <packets@lowlamp.test>',
  signinLockSeconds: wholeSeconds('SIGNIN_LOCK_SECONDS', 900),
  signinSessionSeconds: wholeSeconds('SIGNIN_SESSION_SECONDS', 2_592_000),
} as const;

export const SYNC_BODY_LIMIT = 5_000_000;
export const DEFAULT_BODY_LIMIT = 100_000;
export const PROVIDER_TIMEOUT_MS = 10_000;
export const RENDER_TIMEOUT_MS = 60_000;
