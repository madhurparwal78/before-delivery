export interface Config {
  port: number;
  grading: boolean;
  settings: {
    check_interval_ms: number;
    pending_checks: number;
    flap_changes: number;
    flap_checks: number;
    lifecycle_interval_ms: number;
    snapshot_ttl_ms: number;
    page_size: number;
    tail_buffer: number;
    tail_rate: number;
    sse_heartbeat_ms: number;
    query_max_len: number;
    query_max_depth: number;
    query_work_max: number;
    query_budget_ms: number;
    result_window: number;
    upload_max_bytes: number;
    upload_progress_lines: number;
    upload_rate: number;
    login_rate: number;
    search_rate: number;
    trace_max_spans: number;
  };
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return fallback;
  return v;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  cached = {
    port: num("APP_PUBLIC_PORT", 4173),
    grading: process.env.SPOOR_GRADING === "1",
    settings: {
      check_interval_ms: num("SPOOR_CHECK_INTERVAL_MS", 60000),
      pending_checks: num("SPOOR_PENDING_CHECKS", 2),
      flap_changes: num("SPOOR_FLAP_CHANGES", 4),
      flap_checks: num("SPOOR_FLAP_CHECKS", 10),
      lifecycle_interval_ms: num("SPOOR_LIFECYCLE_INTERVAL_MS", 60000),
      snapshot_ttl_ms: num("SPOOR_SNAPSHOT_TTL_MS", 300000),
      page_size: num("SPOOR_PAGE_SIZE", 100),
      tail_buffer: num("SPOOR_TAIL_BUFFER", 1000),
      tail_rate: num("SPOOR_TAIL_RATE", 200),
      sse_heartbeat_ms: num("SPOOR_SSE_HEARTBEAT_MS", 15000),
      query_max_len: num("SPOOR_QUERY_MAX_LEN", 2000),
      query_max_depth: num("SPOOR_QUERY_MAX_DEPTH", 8),
      query_work_max: num("SPOOR_QUERY_WORK_MAX", 2000000),
      query_budget_ms: num("SPOOR_QUERY_BUDGET_MS", 3000),
      result_window: num("SPOOR_RESULT_WINDOW", 10000),
      upload_max_bytes: num("SPOOR_UPLOAD_MAX_BYTES", 10000000),
      upload_progress_lines: num("SPOOR_UPLOAD_PROGRESS_LINES", 500),
      upload_rate: num("SPOOR_UPLOAD_RATE", 120),
      login_rate: num("SPOOR_LOGIN_RATE", 10),
      search_rate: num("SPOOR_SEARCH_RATE", 600),
      trace_max_spans: num("SPOOR_TRACE_MAX_SPANS", 500),
    },
  };
  return cached;
}

/** The settings the browser reads from /api/config. */
export function browserSettings() {
  const s = config().settings;
  return {
    page_size: s.page_size,
    tail_buffer: s.tail_buffer,
    query_max_len: s.query_max_len,
    query_max_depth: s.query_max_depth,
    upload_max_bytes: s.upload_max_bytes,
    sse_heartbeat_ms: s.sse_heartbeat_ms,
  };
}

const RATE_KEYS = ["upload", "login", "search", "tail"] as const;
export type RateKey = (typeof RATE_KEYS)[number];

/** Runtime rate overrides set by the grading seed. */
const rateOverrides = new Map<RateKey, number>();

export function setRateOverride(key: RateKey, value: number): void {
  rateOverrides.set(key, value);
}

export function rateLimit(key: RateKey): number {
  const o = rateOverrides.get(key);
  if (o !== undefined) return o;
  const s = config().settings;
  switch (key) {
    case "upload":
      return s.upload_rate;
    case "login":
      return s.login_rate;
    case "search":
      return s.search_rate;
    case "tail":
      return s.tail_rate;
  }
}

export function clearRateOverrides(): void {
  rateOverrides.clear();
}
