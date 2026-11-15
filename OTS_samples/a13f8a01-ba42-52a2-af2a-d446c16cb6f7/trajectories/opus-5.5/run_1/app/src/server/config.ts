function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Environment variable ${name} must be a whole number`);
  return value;
}

const publicUrl = new URL(required("APP_PUBLIC_URL"));

export const config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: integer("SMTP_PORT", 1025),
  },
  mailFrom: required("MAIL_FROM"),
  publicUrl: publicUrl.href.replace(/\/+$/, ""),
  publicOrigin: publicUrl.origin,
  port: integer("APP_PUBLIC_PORT", 4173),
  previewDelayMs: integer("ASHLAR_PREVIEW_DELAY_MS", 500),
  loopLimit: integer("ASHLAR_LOOP_LIMIT", 100000),
  verifyTtlSeconds: integer("ASHLAR_VERIFY_TTL_SECONDS", 86400),
  draftIntervalMs: integer("ASHLAR_DRAFT_INTERVAL_MS", 5000),
  searchDebounceMs: integer("ASHLAR_SEARCH_DEBOUNCE_MS", 250),
  paneLimitBytes: integer("ASHLAR_PANE_LIMIT_BYTES", 200000),
  maxTags: integer("ASHLAR_MAX_TAGS", 5),
  bodyLimitBytes: integer("ASHLAR_BODY_LIMIT_BYTES", 1000000),
  grading: process.env.ASHLAR_GRADING === "1",
};
