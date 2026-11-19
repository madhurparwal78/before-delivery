import { randomBytes } from 'node:crypto';

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

/** Names this running process: time-driven work on a map belongs to the process that last wrote it. */
export const instanceId = randomBytes(6).toString('hex');

/** Every setting the app reads from its environment, read once at boot. */
export const config = {
  port: number('APP_PUBLIC_PORT', 4173),
  grading: process.env.SPRIG_GRADING === '1',
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  presenceTimeoutMs: number('SPRIG_PRESENCE_TIMEOUT_MS', 15000),
  versionIntervalMs: number('SPRIG_VERSION_INTERVAL_MS', 300000),
  presenterGraceMs: number('SPRIG_PRESENTER_GRACE_MS', 60000),
  sessionTtlMs: number('SPRIG_SESSION_TTL_MS', 604800000),
  opWindow: number('SPRIG_OP_WINDOW', 1000),
  virtualFrom: number('SPRIG_VIRTUAL_FROM', 300),
  domMarginPx: number('SPRIG_DOM_MARGIN_PX', 200),
  domCeiling: number('SPRIG_DOM_CEILING', 400),
  attachMaxBytes: number('SPRIG_ATTACH_MAX_BYTES', 2000000),
  mapQuotaBytes: number('SPRIG_MAP_QUOTA_BYTES', 20000000),
  outlineMaxBytes: number('SPRIG_OUTLINE_MAX_BYTES', 1000000),
  exportStepMs: number('SPRIG_EXPORT_STEP_MS', 400),
  opRate: number('SPRIG_OP_RATE', 600),
  loginRate: number('SPRIG_LOGIN_RATE', 10),
  toastMs: number('SPRIG_TOAST_MS', 5000),
  undoDepth: number('SPRIG_UNDO_DEPTH', 100),
} as const;
