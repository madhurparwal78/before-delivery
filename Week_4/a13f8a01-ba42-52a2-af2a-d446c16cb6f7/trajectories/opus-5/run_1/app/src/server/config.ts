const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} is not a number`);
  return value;
};

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtpHost: string;
  smtpPort: number;
  mailpitUrl: string;
  mailFrom: string;
  appPublicUrl: string;
  port: number;
  previewDelayMs: number;
  loopLimit: number;
  verifyTtlSeconds: number;
  draftIntervalMs: number;
  searchDebounceMs: number;
  paneLimitBytes: number;
  maxTags: number;
  bodyLimitBytes: number;
  grading: boolean;
}

const loadConfig = (): Config => ({
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailpitUrl: required('MAILPIT_URL'),
  mailFrom: required('MAIL_FROM'),
  appPublicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  port: integer('APP_PUBLIC_PORT', 4173),
  previewDelayMs: integer('ASHLAR_PREVIEW_DELAY_MS', 500),
  loopLimit: integer('ASHLAR_LOOP_LIMIT', 100000),
  verifyTtlSeconds: integer('ASHLAR_VERIFY_TTL_SECONDS', 86400),
  draftIntervalMs: integer('ASHLAR_DRAFT_INTERVAL_MS', 5000),
  searchDebounceMs: integer('ASHLAR_SEARCH_DEBOUNCE_MS', 250),
  paneLimitBytes: integer('ASHLAR_PANE_LIMIT_BYTES', 200000),
  maxTags: integer('ASHLAR_MAX_TAGS', 5),
  bodyLimitBytes: integer('ASHLAR_BODY_LIMIT_BYTES', 1000000),
  grading: process.env.ASHLAR_GRADING === '1',
});

export const config = loadConfig();
