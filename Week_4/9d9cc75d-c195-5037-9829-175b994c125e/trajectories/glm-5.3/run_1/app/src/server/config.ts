export interface Config {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  appPublicPort: number;
  appPublicUrl: string;
  grading: boolean;
  formulaMaxChars: number;
  formulaMaxDepth: number;
  markMax: number;
  queryWorkMax: number;
  queryBudgetMs: number;
  rowMax: number;
  csvMaxBytes: number;
  formulaDebounceMs: number;
  staleMs: number;
  exportStepMs: number;
  sseHeartbeatMs: number;
  loginRate: number;
  formulaRate: number;
  queryRate: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string): boolean {
  const raw = process.env[name];
  return raw === "1" || raw === "true" || raw === "yes";
}

export function loadConfig(): Config {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3Endpoint: process.env.S3_ENDPOINT ?? "",
    s3Region: process.env.S3_REGION ?? "",
    s3Bucket: process.env.S3_BUCKET ?? "",
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false" && process.env.S3_FORCE_PATH_STYLE !== "0",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    appPublicPort: num("APP_PUBLIC_PORT", 4173),
    appPublicUrl: process.env.APP_PUBLIC_URL ?? "",
    grading: bool("LOZ_GRADING"),
    formulaMaxChars: num("LOZ_FORMULA_MAX_CHARS", 2000),
    formulaMaxDepth: num("LOZ_FORMULA_MAX_DEPTH", 16),
    markMax: num("LOZ_MARK_MAX", 2000),
    queryWorkMax: num("LOZ_QUERY_WORK_MAX", 5000000),
    queryBudgetMs: num("LOZ_QUERY_BUDGET_MS", 5000),
    rowMax: num("LOZ_ROW_MAX", 50000),
    csvMaxBytes: num("LOZ_CSV_MAX_BYTES", 20000000),
    formulaDebounceMs: num("LOZ_FORMULA_DEBOUNCE_MS", 300),
    staleMs: num("LOZ_STALE_MS", 7200000),
    exportStepMs: num("LOZ_EXPORT_STEP_MS", 200),
    sseHeartbeatMs: num("LOZ_SSE_HEARTBEAT_MS", 15000),
    loginRate: num("LOZ_LOGIN_RATE", 10),
    formulaRate: num("LOZ_FORMULA_RATE", 120),
    queryRate: num("LOZ_QUERY_RATE", 600),
  };
}
