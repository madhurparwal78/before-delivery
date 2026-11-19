function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  databaseUrl: str('DATABASE_URL', ''),
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  port: num('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', ''),
  grading: process.env.LOZ_GRADING === '1',
  formulaMaxChars: num('LOZ_FORMULA_MAX_CHARS', 2000),
  formulaMaxDepth: num('LOZ_FORMULA_MAX_DEPTH', 16),
  markMax: num('LOZ_MARK_MAX', 2000),
  queryWorkMax: num('LOZ_QUERY_WORK_MAX', 5000000),
  queryBudgetMs: num('LOZ_QUERY_BUDGET_MS', 5000),
  rowMax: num('LOZ_ROW_MAX', 50000),
  csvMaxBytes: num('LOZ_CSV_MAX_BYTES', 20000000),
  formulaDebounceMs: num('LOZ_FORMULA_DEBOUNCE_MS', 300),
  staleMs: num('LOZ_STALE_MS', 7200000),
  exportStepMs: num('LOZ_EXPORT_STEP_MS', 200),
  sseHeartbeatMs: num('LOZ_SSE_HEARTBEAT_MS', 15000),
  loginRate: num('LOZ_LOGIN_RATE', 10),
  formulaRate: num('LOZ_FORMULA_RATE', 120),
  queryRate: num('LOZ_QUERY_RATE', 600),
} as const;

export const publicConfig = {
  formula_max_chars: config.formulaMaxChars,
  formula_max_depth: config.formulaMaxDepth,
  mark_max: config.markMax,
  formula_debounce_ms: config.formulaDebounceMs,
  row_max: config.rowMax,
  csv_max_bytes: config.csvMaxBytes,
  sse_heartbeat_ms: config.sseHeartbeatMs,
};
