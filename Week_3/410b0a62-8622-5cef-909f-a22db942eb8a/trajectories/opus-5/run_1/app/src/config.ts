function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function required(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function intEnv(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

function decimalEnv(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number`);
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = env(name);
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const appTz = env('APP_TZ') ?? 'UTC';

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: env('S3_REGION') ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: boolEnv('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gradingKey: env('GRADING_KEY'),
  appTz,
  appToday: env('APP_TODAY') ?? todayIn(appTz),
  liveHeartbeatMs: intEnv('LIVE_HEARTBEAT_MS', 15000),
  activityMaxBytes: intEnv('ACTIVITY_MAX_BYTES', 1048576),
  activityMaxSamples: intEnv('ACTIVITY_MAX_SAMPLES', 21600),
  linkRequestTtlHours: decimalEnv('LINK_REQUEST_TTL_HOURS', 72),
  uploadTimeoutMs: intEnv('UPLOAD_TIMEOUT_MS', 5000),
  chartAnimationMs: intEnv('CHART_ANIMATION_MS', 450),
  publicPort: intEnv('APP_PUBLIC_PORT', 4173),
} as const;

export const JSON_BODY_MAX_BYTES = 1_000_000;
export const SEED_BODY_MAX_BYTES = 20_000_000;
