function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  port: num('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  databaseUrl: str('DATABASE_URL', ''),
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    pathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  grading: process.env.KIP_GRADING === '1',
  holdMs: num('KIP_HOLD_MS', 900000),
  quoteTtlMs: num('KIP_QUOTE_TTL_MS', 600000),
  reviewWindowMs: num('KIP_REVIEW_WINDOW_MS', 2592000000),
  mapDebounceMs: num('KIP_MAP_DEBOUNCE_MS', 400),
  typeDebounceMs: num('KIP_TYPE_DEBOUNCE_MS', 200),
  pageSize: num('KIP_PAGE_SIZE', 20),
  sseHeartbeatMs: num('KIP_SSE_HEARTBEAT_MS', 15000),
  toastMs: num('KIP_TOAST_MS', 5000),
  loginRate: num('KIP_LOGIN_RATE', 10),
  lookupRate: num('KIP_LOOKUP_RATE', 10),
  searchRate: num('KIP_SEARCH_RATE', 120),
  importMaxBytes: num('KIP_IMPORT_MAX_BYTES', 1000000),
};

/** The settings the browser needs; never credentials. */
export function clientSettings(): Record<string, number | boolean> {
  return {
    mapDebounceMs: config.mapDebounceMs,
    typeDebounceMs: config.typeDebounceMs,
    toastMs: config.toastMs,
    pageSize: config.pageSize,
    importMaxBytes: config.importMaxBytes,
  };
}

export const COMMISSION_PCT = 9;
export const REVIEW_HALF_LIFE_DAYS = 180;
export const LOYALTY_WINDOW_DAYS = 730;
export const MAX_NIGHTS = 30;
