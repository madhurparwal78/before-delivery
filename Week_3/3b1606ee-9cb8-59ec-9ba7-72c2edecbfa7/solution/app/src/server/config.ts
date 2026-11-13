function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  databaseUrl: text('DATABASE_URL'),
  grading: process.env.GRADING === '1',
  attachmentMaxBytes: whole('ATTACHMENT_MAX_BYTES', 26_214_400),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    pathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  timers: {
    undo_ms: whole('UNDO_MS', 5000),
    connecting_delay_ms: whole('CONNECTING_DELAY_MS', 2000),
    availability_debounce_ms: whole('AVAILABILITY_DEBOUNCE_MS', 300),
    retry_base_ms: whole('RETRY_BASE_MS', 1000),
    retry_cap_ms: whole('RETRY_CAP_MS', 60000),
    toast_ms: whole('TOAST_MS', 4000),
  },
} as const;
