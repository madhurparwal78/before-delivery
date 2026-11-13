// The only place the environment is read.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

const port = integer("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 1025), from: required("MAIL_FROM") },
  valkey: { url: required("VALKEY_URL"), prefix: process.env.VALKEY_KEY_PREFIX ?? "tinework:" },
  evalDebounceMs: integer("EVAL_DEBOUNCE_MS", 400),
  slowEvalNoticeMs: integer("SLOW_EVAL_NOTICE_MS", 3000),
  evalTimeoutMs: integer("EVAL_TIMEOUT_MS", 8000),
  verifyTokenTtlSeconds: integer("VERIFY_TOKEN_TTL_SECONDS", 3600),
  idempotencyTtlSeconds: integer("IDEMPOTENCY_TTL_SECONDS", 86400),
  outboxRetentionSeconds: integer("OUTBOX_RETENTION_SECONDS", 900),
  preflightSignedOutLimit: integer("PREFLIGHT_SIGNED_OUT_LIMIT", 1),
  requiredApprovals: integer("REQUIRED_APPROVALS", 2),
  commentMaxChars: integer("COMMENT_MAX_CHARS", 500),
} as const;

/** The non-secret values the browser may read. */
export const publicConfig = {
  evalDebounceMs: config.evalDebounceMs,
  slowEvalNoticeMs: config.slowEvalNoticeMs,
  commentMaxChars: config.commentMaxChars,
  requiredApprovals: config.requiredApprovals,
  preflightSignedOutLimit: config.preflightSignedOutLimit,
};
