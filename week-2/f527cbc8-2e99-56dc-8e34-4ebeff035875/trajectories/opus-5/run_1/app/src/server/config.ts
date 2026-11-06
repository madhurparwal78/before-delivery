/**
 * Every service URL, credential and tunable is read from the environment once at start.
 * Nothing here is ever sent to the browser except the published numeric defaults that
 * the API itself reports (chunk size, ranges).
 */

function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required environment variable ${name}`);
  }
  return raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`environment variable ${name} is not a number`);
  return Math.trunc(n);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function intList(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

export type RateBucket = 'sign_in' | 'hold' | 'payment' | 'upload' | 'vet';
export type RateScope = 'user' | 'address';

export interface RateLimitSetting {
  capacity: number;
  refillPerMinute: number;
}

const rateDefaults: Record<RateBucket, Record<RateScope, RateLimitSetting | null>> = {
  sign_in: { user: { capacity: 10, refillPerMinute: 2 }, address: { capacity: 240, refillPerMinute: 120 } },
  hold: { user: { capacity: 60, refillPerMinute: 12 }, address: { capacity: 300, refillPerMinute: 120 } },
  payment: { user: { capacity: 20, refillPerMinute: 6 }, address: { capacity: 100, refillPerMinute: 30 } },
  upload: { user: { capacity: 200, refillPerMinute: 60 }, address: { capacity: 400, refillPerMinute: 120 } },
  vet: { user: null, address: { capacity: 60, refillPerMinute: 30 } },
};

function rateSetting(bucket: RateBucket, scope: RateScope): RateLimitSetting | null {
  const base = rateDefaults[bucket][scope];
  if (base === null) return null;
  const prefix = `RATE_${bucket.toUpperCase()}_${scope.toUpperCase()}`;
  return {
    capacity: int(`${prefix}_CAPACITY`, base.capacity),
    refillPerMinute: int(`${prefix}_REFILL_PER_MINUTE`, base.refillPerMinute),
  };
}

export const config = {
  databaseUrl: str('DATABASE_URL'),

  s3: {
    endpoint: str('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
  },

  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Rasp & Rein <bookings@raspandrein.test>'),
  },

  killbill: {
    url: str('KILLBILL_URL'),
    username: str('KILLBILL_USERNAME'),
    password: str('KILLBILL_PASSWORD'),
    apiKey: str('KILLBILL_API_KEY'),
    apiSecret: str('KILLBILL_API_SECRET'),
  },

  port: int('APP_PUBLIC_PORT', 4173),
  instanceLabel: str('INSTANCE_LABEL', 'primary'),
  clockOffsetSeconds: int('CLOCK_OFFSET_SECONDS', 0),

  bookingHoldSeconds: int('BOOKING_HOLD_SECONDS', 300),
  waitlistOfferSeconds: int('WAITLIST_OFFER_SECONDS', 900),
  vetLinkTtlSeconds: int('VET_LINK_TTL_SECONDS', 1209600),
  photoUrlTtlSeconds: int('PHOTO_URL_TTL_SECONDS', 300),
  photoUrlKeyRotateSeconds: int('PHOTO_URL_KEY_ROTATE_SECONDS', 86400),

  uploadChunkBytes: int('UPLOAD_CHUNK_BYTES', 1000000),
  uploadSessionSeconds: int('UPLOAD_SESSION_SECONDS', 86400),
  visitPhotoQuotaBytes: int('VISIT_PHOTO_QUOTA_BYTES', 48000000),

  dunningRetryDays: intList('DUNNING_RETRY_DAYS', [3, 5, 7]),
  dunningDaySeconds: int('DUNNING_DAY_SECONDS', 86400),

  jobLeaseSeconds: int('JOB_LEASE_SECONDS', 30),
  jobMaxAttempts: int('JOB_MAX_ATTEMPTS', 5),
  jobBackoffBaseSeconds: int('JOB_BACKOFF_BASE_SECONDS', 5),
  jobBackoffMaxSeconds: int('JOB_BACKOFF_MAX_SECONDS', 300),
  reminderScanSeconds: int('REMINDER_SCAN_SECONDS', 300),

  alertOutstandingCents: int('ALERT_OUTSTANDING_CENTS', 50000),
  idempotencyLeaseSeconds: int('IDEMPOTENCY_LEASE_SECONDS', 30),
  shutdownGraceSeconds: int('SHUTDOWN_GRACE_SECONDS', 10),

  sseHeartbeatSeconds: int('SSE_HEARTBEAT_SECONDS', 15),
  sseRetentionEvents: int('SSE_RETENTION_EVENTS', 1000),
  readyCheckTimeoutMs: int('READY_CHECK_TIMEOUT_MS', 2000),
  importDefaultPassword: str('IMPORT_DEFAULT_PASSWORD', 'hoofcare-2026'),

  rateLimit: (bucket: RateBucket, scope: RateScope): RateLimitSetting | null => rateSetting(bucket, scope),
} as const;

/** Fixed limits owned by the brief rather than the environment. */
export const limits = {
  jsonBodyBytes: 65536,
  multipartBytes: 8500000,
  importBytes: 1000000,
  photoBytes: 8000000,
  providerTimeoutMs: 5000,
  visitNoteChars: 500,
} as const;
