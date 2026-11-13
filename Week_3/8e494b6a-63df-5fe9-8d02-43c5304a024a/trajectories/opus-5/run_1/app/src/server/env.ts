function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const settings = {
  grading: process.env.SPOOR_GRADING === '1',
  port: whole('APP_PUBLIC_PORT', 4173),
  checkIntervalMs: whole('SPOOR_CHECK_INTERVAL_MS', 60000),
  pendingChecks: whole('SPOOR_PENDING_CHECKS', 2),
  flapChanges: whole('SPOOR_FLAP_CHANGES', 4),
  flapChecks: whole('SPOOR_FLAP_CHECKS', 10),
  lifecycleIntervalMs: whole('SPOOR_LIFECYCLE_INTERVAL_MS', 60000),
  snapshotTtlMs: whole('SPOOR_SNAPSHOT_TTL_MS', 300000),
  pageSize: whole('SPOOR_PAGE_SIZE', 100),
  tailBuffer: whole('SPOOR_TAIL_BUFFER', 1000),
  tailRate: whole('SPOOR_TAIL_RATE', 200),
  sseHeartbeatMs: whole('SPOOR_SSE_HEARTBEAT_MS', 15000),
  queryMaxLen: whole('SPOOR_QUERY_MAX_LEN', 2000),
  queryMaxDepth: whole('SPOOR_QUERY_MAX_DEPTH', 8),
  queryWorkMax: whole('SPOOR_QUERY_WORK_MAX', 2000000),
  queryBudgetMs: whole('SPOOR_QUERY_BUDGET_MS', 3000),
  resultWindow: whole('SPOOR_RESULT_WINDOW', 10000),
  uploadMaxBytes: whole('SPOOR_UPLOAD_MAX_BYTES', 10000000),
  uploadProgressLines: whole('SPOOR_UPLOAD_PROGRESS_LINES', 500),
  traceMaxSpans: whole('SPOOR_TRACE_MAX_SPANS', 500),
};

/** Rate limits can be replaced for a running server by a grading seed. */
export const rates = {
  upload: whole('SPOOR_UPLOAD_RATE', 120),
  login: whole('SPOOR_LOGIN_RATE', 10),
  search: whole('SPOOR_SEARCH_RATE', 600),
  tail: settings.tailRate,
};

export const storageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'spoorline',
  pathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
};

export const databaseUrl = process.env.DATABASE_URL ?? '';

export const BODY_MAX_BYTES = 1000000;
