/** Every credential, service URL and timing value is read here, once, at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  meilisearch: {
    url: required('MEILISEARCH_URL'),
    apiKey: required('MEILISEARCH_API_KEY'),
    index: process.env.SEARCH_INDEX ?? 'listings',
  },
  wiremockUrl: required('WIREMOCK_URL'),
  otpTtlSeconds: seconds('OTP_TTL_SECONDS', 300),
  codeWindowSeconds: seconds('CODE_WINDOW_SECONDS', 900),
  codeResendSeconds: seconds('CODE_RESEND_SECONDS', 30),
  accessTtlSeconds: seconds('ACCESS_TTL_SECONDS', 900),
  sessionTtlSeconds: seconds('SESSION_TTL_SECONDS', 2592000),
  upiExpirySeconds: seconds('UPI_EXPIRY_SECONDS', 600),
  shareTtlSeconds: seconds('SHARE_TTL_SECONDS', 2592000),
  rateWindowSeconds: seconds('RATE_WINDOW_SECONDS', 60),
  idempotencyTtlSeconds: seconds('IDEMPOTENCY_TTL_SECONDS', 86400),
} as const;

export const PENDING_COOKIE = 'chauraha_pending';
export const SESSION_COOKIE = 'chauraha_session';
export const ACCESS_COOKIE = 'chauraha_access';
