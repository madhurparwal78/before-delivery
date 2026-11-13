export interface ClockLike {
  readonly nowMs: () => number;
}

export interface Settings {
  grading: boolean;
  inlineMaxBytes: number;
  fileMaxBytes: number;
  parallelLimit: number;
  retryMax: number;
  jobTimeoutMs: number;
  artifactTtlMs: number;
  cacheTtlMs: number;
  autoStopMs: number;
  deployApprovalMs: number;
  retargetLimit: number;
  trainMax: number;
  presenceTimeoutMs: number;
  exportStepMs: number;
  exportMaxBytes: number;
  webhookRetryMs: number[];
  webhookAllow: string[];
  sseHeartbeatMs: number;
  writeRate: number;
  loginRate: number;
  toastMs: number;
  bodyMaxBytes: number;
  commitBodyMaxBytes: number;
  defaultBranch: string;
}

function num(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function list(v: string | undefined): string[] {
  if (v === undefined) return [];
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function readSettings(env: NodeJS.ProcessEnv): Settings {
  return {
    grading: env.SPUR_GRADING === '1',
    inlineMaxBytes: num(env.SPUR_INLINE_MAX_BYTES, 65536),
    fileMaxBytes: num(env.SPUR_FILE_MAX_BYTES, 5000000),
    parallelLimit: num(env.SPUR_PARALLEL_LIMIT, 4),
    retryMax: num(env.SPUR_RETRY_MAX, 2),
    jobTimeoutMs: num(env.SPUR_JOB_TIMEOUT_MS, 3600000),
    artifactTtlMs: num(env.SPUR_ARTIFACT_TTL_MS, 604800000),
    cacheTtlMs: num(env.SPUR_CACHE_TTL_MS, 1209600000),
    autoStopMs: num(env.SPUR_AUTO_STOP_MS, 86400000),
    deployApprovalMs: num(env.SPUR_DEPLOY_APPROVAL_MS, 86400000),
    retargetLimit: num(env.SPUR_RETARGET_LIMIT, 4),
    trainMax: num(env.SPUR_TRAIN_MAX, 20),
    presenceTimeoutMs: num(env.SPUR_PRESENCE_TIMEOUT_MS, 15000),
    exportStepMs: num(env.SPUR_EXPORT_STEP_MS, 400),
    exportMaxBytes: num(env.SPUR_EXPORT_MAX_BYTES, 50000000),
    webhookRetryMs: list(env.SPUR_WEBHOOK_RETRY_MS).map((s) => num(s, 0)),
    webhookAllow: list(env.SPUR_WEBHOOK_ALLOW),
    sseHeartbeatMs: num(env.SPUR_SSE_HEARTBEAT_MS, 15000),
    writeRate: num(env.SPUR_WRITE_RATE, 600),
    loginRate: num(env.SPUR_LOGIN_RATE, 10),
    toastMs: num(env.SPUR_TOAST_MS, 5000),
    bodyMaxBytes: 1000000,
    commitBodyMaxBytes: 10000000,
    defaultBranch: 'main',
  };
}

export function maxBodyBytes(s: Settings, kind: 'json' | 'commit' | 'import'): number {
  if (kind === 'commit') return s.commitBodyMaxBytes;
  if (kind === 'import') return s.exportMaxBytes;
  return s.bodyMaxBytes;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function readS3Config(env: NodeJS.ProcessEnv): S3Config | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET || 'spurline',
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

export interface ClockLike {
  readonly nowMs: () => number;
}

export const PIPELINE_FILE = 'spurline.pipeline.yml';
export const OWNERS_FILE = '.spurline/OWNERS';
export const REQUEST_TEMPLATE = '.spurline/request-template.md';

export interface Env {
  settings: Settings;
  s3: S3Config | null;
  databaseUrl: string;
  port: number;
  publicUrl: string;
}

export function readEnv(env: NodeJS.ProcessEnv): Env {
  return {
    settings: readSettings(env),
    s3: readS3Config(env),
    databaseUrl: env.DATABASE_URL || '',
    port: num(env.APP_PUBLIC_PORT, 4173),
    publicUrl: env.APP_PUBLIC_URL || `http://127.0.0.1:${num(env.APP_PUBLIC_PORT, 4173)}`,
  };
}

export function newServerClock(grading: boolean): ClockLike {
  const t = new Date('2026-01-01T00:00:00Z').getTime();
  if (grading) return { nowMs: () => t };
  return { nowMs: () => Date.now() };
}
