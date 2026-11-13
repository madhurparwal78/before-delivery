function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  meilisearchUrl: required('MEILISEARCH_URL'),
  meilisearchApiKey: optional('MEILISEARCH_API_KEY'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: boolean('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025, 1, 65535),
  mailFrom: process.env['MAIL_FROM'] ?? 'Candour Bench <no-reply@candour-bench.test>',
  mailpitUrl: optional('MAILPIT_URL'),
  appPublicUrl: process.env['APP_PUBLIC_URL'] ?? 'http://127.0.0.1:4173',
  port: integer('APP_PUBLIC_PORT', 4173, 1, 65535),
  gradingToken: optional('GRADING_TOKEN'),
  founderEmail: optional('FOUNDER_EMAIL'),
  founderPassword: optional('FOUNDER_PASSWORD'),
  editWindowMinutes: integer('EDIT_WINDOW_MINUTES', 15, 0, 525600),
  emailCodeTtlSeconds: integer('EMAIL_CODE_TTL_SECONDS', 600, 1, 86400),
  emailLinkTtlSeconds: integer('EMAIL_LINK_TTL_SECONDS', 3600, 1, 2592000),
  alertBatchSeconds: integer('ALERT_BATCH_SECONDS', 300, 0, 86400),
  minPayReports: integer('MIN_PAY_REPORTS', 5, 2, 50),
  reviewsPerCompanyPerYear: integer('REVIEWS_PER_COMPANY_PER_YEAR', 1, 1, 100),
  resumeMaxBytes: integer('RESUME_MAX_BYTES', 5242880, 1024, 104857600),
  uploadRatePerMinute: integer('UPLOAD_RATE_PER_MINUTE', 5, 1, 1000),
  claimLapseSeconds: integer('CLAIM_LAPSE_SECONDS', 600, 1, 86400),
  applyKeyTtlSeconds: integer('APPLY_KEY_TTL_SECONDS', 86400, 1, 2592000),
  liveReplayLimit: integer('LIVE_REPLAY_LIMIT', 500, 1, 100000),
  toastSeconds: integer('TOAST_SECONDS', 5, 0, 600),
  searchPageSize: integer('SEARCH_PAGE_SIZE', 20, 1, 200),
  outboxRetrySeconds: integer('OUTBOX_RETRY_SECONDS', 30, 1, 3600),
  markMaxBytes: 1048576,
} as const;

/** The only configuration values the browser is given. */
export function clientConfig(): { toast_seconds: number; min_pay_reports: number; search_page_size: number } {
  return {
    toast_seconds: config.toastSeconds,
    min_pay_reports: config.minPayReports,
    search_page_size: config.searchPageSize,
  };
}
