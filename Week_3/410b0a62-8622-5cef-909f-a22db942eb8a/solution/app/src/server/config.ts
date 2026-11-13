function text(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

function decimal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number`);
  return value;
}

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY')
  },
  gradingKey: process.env['GRADING_KEY'] || null,
  appToday: process.env['APP_TODAY'] || null,
  appTz: text('APP_TZ', 'UTC'),
  liveHeartbeatMs: integer('LIVE_HEARTBEAT_MS', 15_000),
  activityMaxBytes: integer('ACTIVITY_MAX_BYTES', 1_048_576),
  activityMaxSamples: integer('ACTIVITY_MAX_SAMPLES', 21_600),
  linkRequestTtlHours: decimal('LINK_REQUEST_TTL_HOURS', 72),
  uploadTimeoutMs: integer('UPLOAD_TIMEOUT_MS', 5000),
  chartAnimationMs: integer('CHART_ANIMATION_MS', 450)
} as const;

/** Fixed limits the brief itself states. */
export const JSON_BODY_LIMIT = 1_000_000;
export const SEED_BODY_LIMIT = 20_000_000;
export const UPLOAD_ENVELOPE_BYTES = 65_536;
export const DATABASE_RETRY_MS = 1000;
