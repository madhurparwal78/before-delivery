function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid environment variable ${name}`);
  return value;
}

const publicUrl = required('APP_PUBLIC_URL').replace(/\/+$/, '');
const secureCookies = publicUrl.startsWith('https:');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number.parseInt(required('SMTP_PORT'), 10),
    from: required('MAIL_FROM'),
  },
  publicUrl,
  port: Number.parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10),
  cookieName: secureCookies ? '__Host-sw_session' : 'sw_session',
  secureCookies,
  sessionIdleSeconds: seconds('SESSION_IDLE_SECONDS', 1800),
  sessionAbsoluteSeconds: seconds('SESSION_ABSOLUTE_SECONDS', 43200),
  signinWindowSeconds: seconds('SIGNIN_WINDOW_SECONDS', 900),
  signinLockSeconds: seconds('SIGNIN_LOCK_SECONDS', 900),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 259200),
  inviteRateWindowSeconds: seconds('INVITE_RATE_WINDOW_SECONDS', 3600),
  inviteLookupWindowSeconds: seconds('INVITE_LOOKUP_WINDOW_SECONDS', 600),
  idempotencyKeySeconds: seconds('IDEMPOTENCY_KEY_SECONDS', 86400),
  downloadLinkSeconds: seconds('DOWNLOAD_LINK_SECONDS', 60),
} as const;

export const SIGNIN_PAIR_THRESHOLD = 5;
export const SIGNIN_IP_THRESHOLD = 20;
export const INVITE_RATE_LIMIT = 20;
export const INVITE_LOOKUP_LIMIT = 20;
