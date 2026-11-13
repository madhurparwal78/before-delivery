const env = process.env

function text(name: string, fallback: string): string {
  return env[name] ?? fallback
}

function whole(name: string, fallback: number): number {
  const value = Number(env[name])
  return env[name] !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: text('APP_PUBLIC_URL', ''),
  databaseUrl: text('DATABASE_URL', ''),
  s3: {
    endpoint: text('S3_ENDPOINT', ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    pathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  grading: env.KIP_GRADING === '1',
  holdMs: whole('KIP_HOLD_MS', 900000),
  quoteTtlMs: whole('KIP_QUOTE_TTL_MS', 600000),
  reviewWindowMs: whole('KIP_REVIEW_WINDOW_MS', 2592000000),
  mapDebounceMs: whole('KIP_MAP_DEBOUNCE_MS', 400),
  typeDebounceMs: whole('KIP_TYPE_DEBOUNCE_MS', 200),
  pageSize: whole('KIP_PAGE_SIZE', 20),
  heartbeatMs: whole('KIP_SSE_HEARTBEAT_MS', 15000),
  toastMs: whole('KIP_TOAST_MS', 5000),
  loginRate: whole('KIP_LOGIN_RATE', 10),
  lookupRate: whole('KIP_LOOKUP_RATE', 10),
  searchRate: whole('KIP_SEARCH_RATE', 120),
  importMaxBytes: whole('KIP_IMPORT_MAX_BYTES', 1000000),
}

export const COMMISSION_PCT = 9
export const JSON_MAX_BYTES = 65536
export const HALF_LIFE_DAYS = 180
export const LOYALTY_DAYS = 730
export const MAX_NIGHTS = 30
export const DATES_WINDOW_DAYS = 400
export const CALENDAR_WINDOW_DAYS = 90
export const BUCKET_MINOR = 5000
export const BUCKETS = 12
export const COMMENT_MAX = 2000
export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000
export const RECONNECT_LOOKBACK_MS = 2 * 3600 * 1000
