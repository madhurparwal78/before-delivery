function text(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set in the environment`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT"),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  // Mail leaves over SMTP; Mailpit's web address is held for the service's own inbox and is never sent to the browser.
  smtp: { host: text("SMTP_HOST"), port: whole("SMTP_PORT", 25), from: text("MAIL_FROM"), inboxUrl: (process.env["MAILPIT_URL"] ?? "").replace(/\/+$/, "") },
  previewDelayMs: whole("ASHLAR_PREVIEW_DELAY_MS", 500),
  loopLimit: whole("ASHLAR_LOOP_LIMIT", 100000),
  verifyTtlSeconds: whole("ASHLAR_VERIFY_TTL_SECONDS", 86400),
  draftIntervalMs: whole("ASHLAR_DRAFT_INTERVAL_MS", 5000),
  searchDebounceMs: whole("ASHLAR_SEARCH_DEBOUNCE_MS", 250),
  paneLimitBytes: whole("ASHLAR_PANE_LIMIT_BYTES", 200000),
  maxTags: whole("ASHLAR_MAX_TAGS", 5),
  bodyLimitBytes: whole("ASHLAR_BODY_LIMIT_BYTES", 1000000),
  grading: process.env["ASHLAR_GRADING"] === "1",
} as const;

export const LIVE_POLL_MS = 1000;
export const SEARCH_LIMIT = 50;
export const IDEMPOTENCY_RETENTION_HOURS = 24;
export const RENDER_LIFETIME_MINUTES = 60;
