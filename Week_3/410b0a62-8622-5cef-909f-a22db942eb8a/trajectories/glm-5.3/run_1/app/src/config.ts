import { createHash } from 'node:crypto';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  gradingKey: string | null;
  appToday: string;
  appTz: string;
  liveHeartbeatMs: number;
  activityMaxBytes: number;
  activityMaxSamples: number;
  linkRequestTtlHours: number;
  uploadTimeoutMs: number;
  chartAnimationMs: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const todayRaw = process.env.APP_TODAY?.trim() ?? '';
  const appTz = process.env.APP_TZ?.trim() || 'UTC';
  const appToday =
    todayRaw && todayRaw !== 'auto'
      ? todayRaw
      : new Intl.DateTimeFormat('en-CA', { timeZone: appTz, dateStyle: 'short' }).format(new Date());
  const gradingKey = process.env.GRADING_KEY?.trim() || null;
  return {
    port: num('APP_PUBLIC_PORT', 4173),
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    gradingKey,
    appToday,
    appTz,
    liveHeartbeatMs: num('LIVE_HEARTBEAT_MS', 15000),
    activityMaxBytes: num('ACTIVITY_MAX_BYTES', 1048576),
    activityMaxSamples: num('ACTIVITY_MAX_SAMPLES', 21600),
    linkRequestTtlHours: num('LINK_REQUEST_TTL_HOURS', 72),
    uploadTimeoutMs: num('UPLOAD_TIMEOUT_MS', 5000),
    chartAnimationMs: num('CHART_ANIMATION_MS', 450),
  };
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
