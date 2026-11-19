// Every environment variable the app reads, read once at start. Nothing here is logged or sent to the browser.

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  databaseUrl: string;
  s3: S3Config;
  port: number;
  publicUrl: string;
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

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function whole(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

export function loadConfig(env: Env): Config {
  const port = whole(env, 'APP_PUBLIC_PORT', 4173);
  const grading = env.LOZ_GRADING;
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    s3: {
      endpoint: required(env, 'S3_ENDPOINT'),
      region: required(env, 'S3_REGION'),
      bucket: required(env, 'S3_BUCKET'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
    },
    port,
    publicUrl: required(env, 'APP_PUBLIC_URL'),
    grading: grading !== undefined && grading !== '' && grading !== '0' && grading !== 'false',
    formulaMaxChars: whole(env, 'LOZ_FORMULA_MAX_CHARS', 2000),
    formulaMaxDepth: whole(env, 'LOZ_FORMULA_MAX_DEPTH', 16),
    markMax: whole(env, 'LOZ_MARK_MAX', 2000),
    queryWorkMax: whole(env, 'LOZ_QUERY_WORK_MAX', 5000000),
    queryBudgetMs: whole(env, 'LOZ_QUERY_BUDGET_MS', 5000),
    rowMax: whole(env, 'LOZ_ROW_MAX', 50000),
    csvMaxBytes: whole(env, 'LOZ_CSV_MAX_BYTES', 20000000),
    formulaDebounceMs: whole(env, 'LOZ_FORMULA_DEBOUNCE_MS', 300),
    staleMs: whole(env, 'LOZ_STALE_MS', 7200000),
    exportStepMs: whole(env, 'LOZ_EXPORT_STEP_MS', 200),
    sseHeartbeatMs: whole(env, 'LOZ_SSE_HEARTBEAT_MS', 15000),
    loginRate: whole(env, 'LOZ_LOGIN_RATE', 10),
    formulaRate: whole(env, 'LOZ_FORMULA_RATE', 120),
    queryRate: whole(env, 'LOZ_QUERY_RATE', 600),
  };
}
