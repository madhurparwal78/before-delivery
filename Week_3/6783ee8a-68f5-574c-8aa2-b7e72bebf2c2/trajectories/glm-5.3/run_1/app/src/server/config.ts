export type Limits = {
  double_press_ms: number;
  exec_limit_ms: number;
  autosave_ms: number;
  output_line_cap: number;
  output_byte_cap: number;
  table_page_rows: number;
  import_max_bytes: number;
  checkpoints_kept: number;
  presence_timeout_ms: number;
};

function intEnv(name: string, fallback: number): number {
  const trimmed = process.env[name]?.trim();
  if (trimmed === undefined || trimmed === "") return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

export const limits: Limits = {
  double_press_ms: intEnv("BRACKENPAD_DOUBLE_PRESS_MS", 500),
  exec_limit_ms: intEnv("BRACKENPAD_EXEC_LIMIT_MS", 10000),
  autosave_ms: intEnv("BRACKENPAD_AUTOSAVE_MS", 2000),
  output_line_cap: intEnv("BRACKENPAD_OUTPUT_LINE_CAP", 200),
  output_byte_cap: intEnv("BRACKENPAD_OUTPUT_BYTE_CAP", 1000000),
  table_page_rows: intEnv("BRACKENPAD_TABLE_PAGE_ROWS", 25),
  import_max_bytes: intEnv("BRACKENPAD_IMPORT_MAX_BYTES", 5000000),
  checkpoints_kept: intEnv("BRACKENPAD_CHECKPOINTS_KEPT", 10),
  presence_timeout_ms: intEnv("BRACKENPAD_PRESENCE_TIMEOUT_MS", 20000),
};

export const dbUrl = process.env.DATABASE_URL ?? "";
export const s3 = {
  endpoint: process.env.S3_ENDPOINT ?? "",
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
};
export const smtp = {
  host: process.env.SMTP_HOST ?? "",
  port: intEnv("SMTP_PORT", 1025),
};
export const mailFrom = process.env.MAIL_FROM ?? "Brackenpad <hello@brackenpad.test>";
export const meili = {
  url: (process.env.MEILISEARCH_URL ?? "").replace(/\/+$/, ""),
  apiKey: process.env.MEILISEARCH_API_KEY ?? "",
};
export const appPublicPort = intEnv("APP_PUBLIC_PORT", 4173);
export const appOrigin = (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${appPublicPort}`).replace(/\/+$/, "");
export const grading = process.env.BRACKENPAD_GRADING === "1";

export function publicConfig() {
  return { ...limits };
}

export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  const s = String(seconds);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

export const jsonBodyLimitBytes = 8_000_000;

/** Errors are collected as path -> message pairs, in document order. */
export type FieldErrors = { path: string; message: string }[];
