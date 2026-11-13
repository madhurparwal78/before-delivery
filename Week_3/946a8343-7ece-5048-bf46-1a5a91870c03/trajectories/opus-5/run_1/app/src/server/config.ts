function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function list(name: string, fallback: string): string[] {
  return str(name, fallback)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export const config = {
  port: num('APP_PUBLIC_PORT', 4173),
  databaseUrl: str('DATABASE_URL', ''),
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    pathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  grading: str('SPUR_GRADING', '') === '1',
  inlineMaxBytes: num('SPUR_INLINE_MAX_BYTES', 65536),
  fileMaxBytes: num('SPUR_FILE_MAX_BYTES', 5000000),
  parallelLimit: num('SPUR_PARALLEL_LIMIT', 4),
  retryMax: num('SPUR_RETRY_MAX', 2),
  jobTimeoutMs: num('SPUR_JOB_TIMEOUT_MS', 3600000),
  artifactTtlMs: num('SPUR_ARTIFACT_TTL_MS', 604800000),
  cacheTtlMs: num('SPUR_CACHE_TTL_MS', 1209600000),
  autoStopMs: num('SPUR_AUTO_STOP_MS', 86400000),
  deployApprovalMs: num('SPUR_DEPLOY_APPROVAL_MS', 86400000),
  retargetLimit: num('SPUR_RETARGET_LIMIT', 4),
  trainMax: num('SPUR_TRAIN_MAX', 20),
  presenceTimeoutMs: num('SPUR_PRESENCE_TIMEOUT_MS', 15000),
  exportStepMs: num('SPUR_EXPORT_STEP_MS', 400),
  exportMaxBytes: num('SPUR_EXPORT_MAX_BYTES', 50000000),
  webhookRetryMs: list('SPUR_WEBHOOK_RETRY_MS', '60000,300000,900000').map((v) => Number(v)),
  webhookAllow: list('SPUR_WEBHOOK_ALLOW', ''),
  sseHeartbeatMs: num('SPUR_SSE_HEARTBEAT_MS', 15000),
  writeRate: num('SPUR_WRITE_RATE', 600),
  loginRate: num('SPUR_LOGIN_RATE', 10),
  toastMs: num('SPUR_TOAST_MS', 5000),
} as const;

export const bodyLimits = {
  normal: 1000000,
  commit: 10000000,
  importPack: config.exportMaxBytes,
} as const;
