function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid environment variable ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: intFromEnv('APP_PUBLIC_PORT', 4173),
  grading: process.env['GRADING'] === '1',
  attachmentMaxBytes: intFromEnv('ATTACHMENT_MAX_BYTES', 26_214_400),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  timers: {
    undo_ms: intFromEnv('UNDO_MS', 5000),
    connecting_delay_ms: intFromEnv('CONNECTING_DELAY_MS', 2000),
    availability_debounce_ms: intFromEnv('AVAILABILITY_DEBOUNCE_MS', 300),
    retry_base_ms: intFromEnv('RETRY_BASE_MS', 1000),
    retry_cap_ms: intFromEnv('RETRY_CAP_MS', 60000),
    toast_ms: intFromEnv('TOAST_MS', 4000),
  },
} as const;

export const JSON_BODY_LIMIT = 131_072;
export const RETURN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const RETRACT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const USERNAME_HOLD_MS = 14 * 24 * 60 * 60 * 1000;
export const RECOVER_WINDOW_MS = 60_000;
export const RECOVER_MAX_FAILURES = 5;
