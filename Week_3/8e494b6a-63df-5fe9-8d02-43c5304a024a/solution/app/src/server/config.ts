// The one place environment variables are read.
function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface Settings {
  checkIntervalMs: number;
  pendingChecks: number;
  flapChanges: number;
  flapChecks: number;
  lifecycleIntervalMs: number;
  snapshotTtlMs: number;
  pageSize: number;
  tailBuffer: number;
  tailRate: number;
  sseHeartbeatMs: number;
  queryMaxLen: number;
  queryMaxDepth: number;
  queryWorkMax: number;
  queryBudgetMs: number;
  resultWindow: number;
  uploadMaxBytes: number;
  uploadProgressLines: number;
  uploadRate: number;
  loginRate: number;
  searchRate: number;
  traceMaxSpans: number;
}

export const config = {
  grading: process.env.SPOOR_GRADING === "1",
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  settings: {
    checkIntervalMs: whole("SPOOR_CHECK_INTERVAL_MS", 60000),
    pendingChecks: whole("SPOOR_PENDING_CHECKS", 2),
    flapChanges: whole("SPOOR_FLAP_CHANGES", 4),
    flapChecks: whole("SPOOR_FLAP_CHECKS", 10),
    lifecycleIntervalMs: whole("SPOOR_LIFECYCLE_INTERVAL_MS", 60000),
    snapshotTtlMs: whole("SPOOR_SNAPSHOT_TTL_MS", 300000),
    pageSize: whole("SPOOR_PAGE_SIZE", 100),
    tailBuffer: whole("SPOOR_TAIL_BUFFER", 1000),
    tailRate: whole("SPOOR_TAIL_RATE", 200),
    sseHeartbeatMs: whole("SPOOR_SSE_HEARTBEAT_MS", 15000),
    queryMaxLen: whole("SPOOR_QUERY_MAX_LEN", 2000),
    queryMaxDepth: whole("SPOOR_QUERY_MAX_DEPTH", 8),
    queryWorkMax: whole("SPOOR_QUERY_WORK_MAX", 2000000),
    queryBudgetMs: whole("SPOOR_QUERY_BUDGET_MS", 3000),
    resultWindow: whole("SPOOR_RESULT_WINDOW", 10000),
    uploadMaxBytes: whole("SPOOR_UPLOAD_MAX_BYTES", 10000000),
    uploadProgressLines: whole("SPOOR_UPLOAD_PROGRESS_LINES", 500),
    uploadRate: whole("SPOOR_UPLOAD_RATE", 120),
    loginRate: whole("SPOOR_LOGIN_RATE", 10),
    searchRate: whole("SPOOR_SEARCH_RATE", 600),
    traceMaxSpans: whole("SPOOR_TRACE_MAX_SPANS", 500),
  } satisfies Settings,
};

export const JSON_BODY_MAX = 1_000_000;
