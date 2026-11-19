function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const port = int('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: str('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  gradingKey: optional('GRADING_KEY'),

  databaseUrl: str('DATABASE_URL', 'postgresql://postgres@localhost:5432/postgres'),

  s3: {
    endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', 'moothall'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },

  valkey: {
    url: str('VALKEY_URL', 'redis://localhost:6379'),
    keyPrefix: str('VALKEY_KEY_PREFIX', 'mh:'),
  },

  smtp: {
    host: str('SMTP_HOST', 'localhost'),
    port: int('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Moothall <no-reply@moothall.test>'),
  },

  limits: {
    voteRateLimit: int('VOTE_RATE_LIMIT', 60),
    postRateLimit: int('POST_RATE_LIMIT', 20),
    loginLockoutAttempts: int('LOGIN_LOCKOUT_ATTEMPTS', 5),
    loginLockoutSeconds: int('LOGIN_LOCKOUT_SECONDS', 900),
    verifyLinkTtlSeconds: int('VERIFY_LINK_TTL_SECONDS', 86400),
    verifyResendLimit: int('VERIFY_RESEND_LIMIT', 3),
    verifyResendWindowSeconds: int('VERIFY_RESEND_WINDOW_SECONDS', 3600),
    resetLinkTtlSeconds: int('RESET_LINK_TTL_SECONDS', 1800),
    reportDeadlineSeconds: int('REPORT_DEADLINE_SECONDS', 86400),
    archiveAfterDays: int('ARCHIVE_AFTER_DAYS', 183),
    communityMinAccountAgeDays: int('COMMUNITY_MIN_ACCOUNT_AGE_DAYS', 7),
    commentEditWindowSeconds: int('COMMENT_EDIT_WINDOW_SECONDS', 900),
    lockHourSeconds: int('LOCK_HOUR_SECONDS', 3600),
    mod2faMemberThreshold: int('MOD_2FA_MEMBER_THRESHOLD', 1000),
    maxImageBytes: int('MAX_IMAGE_BYTES', 20000000),
  },

  json: {
    maxBodyBytes: 100000,
    multipartOverheadBytes: 100000,
  },

  pageSize: 25,
  maxPixels: 50000000,
  imageSlots: [320, 640, 1080],
} as const;

export type Config = typeof config;
