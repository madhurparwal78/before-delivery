function text(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function whole(name: string, fallback: number): number {
  const value = text(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL') ?? `http://localhost:${port}`,
  gradingKey: text('GRADING_KEY'),
  databaseUrl: text('DATABASE_URL'),
  valkeyUrl: text('VALKEY_URL'),
  valkeyKeyPrefix: text('VALKEY_KEY_PREFIX') ?? 'mh:',
  smtpHost: text('SMTP_HOST'),
  smtpPort: whole('SMTP_PORT', 0),
  mailFrom: text('MAIL_FROM') ?? 'Moothall <no-reply@moothall.test>',
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  limits: {
    votePerMinute: whole('VOTE_RATE_LIMIT', 60),
    postPerMinute: whole('POST_RATE_LIMIT', 20),
    loginLockoutAttempts: whole('LOGIN_LOCKOUT_ATTEMPTS', 5),
    loginLockoutSeconds: whole('LOGIN_LOCKOUT_SECONDS', 900),
    verifyLinkTtlSeconds: whole('VERIFY_LINK_TTL_SECONDS', 86_400),
    verifyResendLimit: whole('VERIFY_RESEND_LIMIT', 3),
    verifyResendWindowSeconds: whole('VERIFY_RESEND_WINDOW_SECONDS', 3_600),
    resetLinkTtlSeconds: whole('RESET_LINK_TTL_SECONDS', 1_800),
    reportDeadlineSeconds: whole('REPORT_DEADLINE_SECONDS', 86_400),
    archiveAfterDays: whole('ARCHIVE_AFTER_DAYS', 183),
    communityMinAccountAgeDays: whole('COMMUNITY_MIN_ACCOUNT_AGE_DAYS', 7),
    commentEditWindowSeconds: whole('COMMENT_EDIT_WINDOW_SECONDS', 900),
    lockHourSeconds: whole('LOCK_HOUR_SECONDS', 3_600),
    mod2faMemberThreshold: whole('MOD_2FA_MEMBER_THRESHOLD', 1_000),
    maxImageBytes: whole('MAX_IMAGE_BYTES', 20_000_000),
  },
} as const;
