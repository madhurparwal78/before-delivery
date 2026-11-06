/** Reads typed configuration from the environment with the published defaults. */
export interface Config {
  port: number;
  instanceLabel: string;
  clockOffsetSeconds: number;

  holdSeconds: number;
  waitlistOfferSeconds: number;
  vetLinkTtlSeconds: number;
  photoUrlTtlSeconds: number;
  photoUrlKeyRotateSeconds: number;

  uploadChunkBytes: number;
  uploadSessionSeconds: number;
  visitPhotoQuotaBytes: number;

  dunningRetryDays: number[];
  dunningDaySeconds: number;

  jobLeaseSeconds: number;
  jobMaxAttempts: number;
  jobBackoffBaseSeconds: number;
  jobBackoffMaxSeconds: number;
  reminderScanSeconds: number;

  alertOutstandingCents: number;
  idempotencyLeaseSeconds: number;
  shutdownGraceSeconds: number;

  sseHeartbeatSeconds: number;
  sseRetentionEvents: number;
  readyCheckTimeoutMs: number;
  importDefaultPassword: string;

  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;

  rate: Record<string, { capacity: number; refillPerMinute: number }>;
}

function num(name: string, def: number, min?: number, max?: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
}

function ratePair(bucket: string, scope: 'USER' | 'ADDRESS', defCap: number, defRefill: number): { capacity: number; refillPerMinute: number } {
  return {
    capacity: num(`RATE_${bucket}_${scope}_CAPACITY`, defCap),
    refillPerMinute: num(`RATE_${bucket}_${scope}_REFILL_PER_MINUTE`, defRefill)
  };
}

export function loadConfig(): Config {
  const retryDays = (process.env.DUNNING_RETRY_DAYS ?? '3,5,7')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(Number)
    .filter(n => Number.isFinite(n));
  return {
    port: num('APP_PUBLIC_PORT', 4173, 1, 65535),
    instanceLabel: process.env.INSTANCE_LABEL || 'primary',
    clockOffsetSeconds: num('CLOCK_OFFSET_SECONDS', 0),

    holdSeconds: num('BOOKING_HOLD_SECONDS', 300),
    waitlistOfferSeconds: num('WAITLIST_OFFER_SECONDS', 900),
    vetLinkTtlSeconds: num('VET_LINK_TTL_SECONDS', 1209600),
    photoUrlTtlSeconds: num('PHOTO_URL_TTL_SECONDS', 300),
    photoUrlKeyRotateSeconds: num('PHOTO_URL_KEY_ROTATE_SECONDS', 86400),

    uploadChunkBytes: num('UPLOAD_CHUNK_BYTES', 1000000),
    uploadSessionSeconds: num('UPLOAD_SESSION_SECONDS', 86400),
    visitPhotoQuotaBytes: num('VISIT_PHOTO_QUOTA_BYTES', 48000000),

    dunningRetryDays: retryDays.length > 0 ? retryDays : [3, 5, 7],
    dunningDaySeconds: num('DUNNING_DAY_SECONDS', 86400),

    jobLeaseSeconds: num('JOB_LEASE_SECONDS', 30),
    jobMaxAttempts: num('JOB_MAX_ATTEMPTS', 5),
    jobBackoffBaseSeconds: num('JOB_BACKOFF_BASE_SECONDS', 5),
    jobBackoffMaxSeconds: num('JOB_BACKOFF_MAX_SECONDS', 300),
    reminderScanSeconds: num('REMINDER_SCAN_SECONDS', 300),

    alertOutstandingCents: num('ALERT_OUTSTANDING_CENTS', 50000),
    idempotencyLeaseSeconds: num('IDEMPOTENCY_LEASE_SECONDS', 30),
    shutdownGraceSeconds: num('SHUTDOWN_GRACE_SECONDS', 10),

    sseHeartbeatSeconds: num('SSE_HEARTBEAT_SECONDS', 15),
    sseRetentionEvents: num('SSE_RETENTION_EVENTS', 1000),
    readyCheckTimeoutMs: num('READY_CHECK_TIMEOUT_MS', 2000),
    importDefaultPassword: process.env.IMPORT_DEFAULT_PASSWORD || 'hoofcare-2026',

    databaseUrl: process.env.DATABASE_URL || '',
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3Region: process.env.S3_REGION || 'us-east-1',
    s3Bucket: process.env.S3_BUCKET || '',
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: num('SMTP_PORT', 1025),
    mailFrom: process.env.MAIL_FROM || '',
    killbillUrl: (process.env.KILLBILL_URL || '').replace(/\/+$/, ''),
    killbillUsername: process.env.KILLBILL_USERNAME || '',
    killbillPassword: process.env.KILLBILL_PASSWORD || '',
    killbillApiKey: process.env.KILLBILL_API_KEY || '',
    killbillApiSecret: process.env.KILLBILL_API_SECRET || '',

    rate: {
      'SIGN_IN.user': ratePair('SIGN_IN', 'USER', 10, 2),
      'SIGN_IN.address': ratePair('SIGN_IN', 'ADDRESS', 240, 120),
      'HOLD.user': ratePair('HOLD', 'USER', 60, 12),
      'HOLD.address': ratePair('HOLD', 'ADDRESS', 300, 120),
      'PAYMENT.user': ratePair('PAYMENT', 'USER', 20, 6),
      'PAYMENT.address': ratePair('PAYMENT', 'ADDRESS', 100, 30),
      'UPLOAD.user': ratePair('UPLOAD', 'USER', 200, 60),
      'UPLOAD.address': ratePair('UPLOAD', 'ADDRESS', 400, 120),
      'VET.address': ratePair('VET', 'ADDRESS', 60, 30)
    }
  };
}

export let config: Config = loadConfig();
