import type { AppConfig } from "../shared/api";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const port = whole("APP_PUBLIC_PORT", 4173);

/** Every environment variable the app reads, in one place. */
export const settings = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  grading: process.env.BRACKENPAD_GRADING === "1",
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    pathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: whole("SMTP_PORT", 1025), from: required("MAIL_FROM") },
  meilisearch: { url: required("MEILISEARCH_URL").replace(/\/+$/, ""), apiKey: required("MEILISEARCH_API_KEY") },
};

/** The published limits, as `GET /api/config` returns them. */
export const limits: AppConfig = {
  double_press_ms: whole("BRACKENPAD_DOUBLE_PRESS_MS", 500),
  exec_limit_ms: whole("BRACKENPAD_EXEC_LIMIT_MS", 10000),
  autosave_ms: whole("BRACKENPAD_AUTOSAVE_MS", 2000),
  output_line_cap: whole("BRACKENPAD_OUTPUT_LINE_CAP", 200),
  output_byte_cap: whole("BRACKENPAD_OUTPUT_BYTE_CAP", 1_000_000),
  table_page_rows: whole("BRACKENPAD_TABLE_PAGE_ROWS", 25),
  import_max_bytes: whole("BRACKENPAD_IMPORT_MAX_BYTES", 5_000_000),
  checkpoints_kept: whole("BRACKENPAD_CHECKPOINTS_KEPT", 10),
  presence_timeout_ms: whole("BRACKENPAD_PRESENCE_TIMEOUT_MS", 20000),
};

/** The largest JSON request body, in bytes. */
export const JSON_BODY_LIMIT = 8_000_000;
