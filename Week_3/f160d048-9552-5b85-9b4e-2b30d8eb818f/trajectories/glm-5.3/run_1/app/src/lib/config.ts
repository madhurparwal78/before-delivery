// Read once at start; never sent to the browser.
function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface Config {
  port: number;
  publicUrl: string;
  gradingToken: string | null;
  founderEmail: string | null;
  founderPassword: string | null;

  databaseUrl: string;
  meilisearchUrl: string;
  meilisearchApiKey: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  mailpitUrl: string;

  editWindowMinutes: number;
  emailCodeTtlSeconds: number;
  emailLinkTtlSeconds: number;
  alertBatchSeconds: number;
  minPayReports: number;
  reviewsPerCompanyPerYear: number;
  resumeMaxBytes: number;
  uploadRatePerMinute: number;
  claimLapseSeconds: number;
  applyKeyTtlSeconds: number;
  liveReplayLimit: number;
  toastSeconds: number;
  searchPageSize: number;
  outboxRetrySeconds: number;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const minPay = int('MIN_PAY_REPORTS', 5);
  if (minPay < 2 || minPay > 50) throw new Error('MIN_PAY_REPORTS must be between 2 and 50');
  cached = {
    port: int('APP_PUBLIC_PORT', 4173),
    publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
    gradingToken: process.env.GRADING_TOKEN && process.env.GRADING_TOKEN !== '' ? process.env.GRADING_TOKEN : null,
    founderEmail: process.env.FOUNDER_EMAIL && process.env.FOUNDER_EMAIL !== '' ? process.env.FOUNDER_EMAIL : null,
    founderPassword:
      process.env.FOUNDER_PASSWORD && process.env.FOUNDER_PASSWORD !== '' ? process.env.FOUNDER_PASSWORD : null,

    databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/candour'),
    meilisearchUrl: str('MEILISEARCH_URL', 'http://127.0.0.1:7700'),
    meilisearchApiKey: str('MEILISEARCH_API_KEY', ''),
    s3Endpoint: str('S3_ENDPOINT', 'http://127.0.0.1:9000'),
    s3Region: str('S3_REGION', 'us-east-1'),
    s3Bucket: str('S3_BUCKET', 'candour'),
    s3ForcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    s3AccessKeyId: str('S3_ACCESS_KEY_ID', ''),
    s3SecretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    smtpHost: str('SMTP_HOST', '127.0.0.1'),
    smtpPort: int('SMTP_PORT', 1025),
    mailFrom: str('MAIL_FROM', 'Candour Bench <no-reply@cand-bench.test>'),
    mailpitUrl: str('MAILPIT_URL', 'http://127.0.0.1:8025'),

    editWindowMinutes: int('EDIT_WINDOW_MINUTES', 15),
    emailCodeTtlSeconds: int('EMAIL_CODE_TTL_SECONDS', 600),
    emailLinkTtlSeconds: int('EMAIL_LINK_TTL_SECONDS', 3600),
    alertBatchSeconds: int('ALERT_BATCH_SECONDS', 300),
    minPayReports: minPay,
    reviewsPerCompanyPerYear: int('REVIEWS_PER_COMPANY_PER_YEAR', 1),
    resumeMaxBytes: int('RESUME_MAX_BYTES', 5242880),
    uploadRatePerMinute: int('UPLOAD_RATE_PER_MINUTE', 5),
    claimLapseSeconds: int('CLAIM_LAPSE_SECONDS', 600),
    applyKeyTtlSeconds: int('APPLY_KEY_TTL_SECONDS', 86400),
    liveReplayLimit: int('LIVE_REPLAY_LIMIT', 500),
    toastSeconds: int('TOAST_SECONDS', 5),
    searchPageSize: int('SEARCH_PAGE_SIZE', 20),
    outboxRetrySeconds: int('OUTBOX_RETRY_SECONDS', 30),
  };
  return cached;
}
