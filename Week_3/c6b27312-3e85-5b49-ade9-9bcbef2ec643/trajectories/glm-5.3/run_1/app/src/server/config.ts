export interface AppConfig {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number };
  mailFrom: string;
  valkeyUrl: string;
  valkeyKeyPrefix: string;
  publicPort: number;
  publicUrl: string;
  evalDebounceMs: number;
  slowEvalNoticeMs: number;
  evalTimeoutMs: number;
  verifyTokenTtlSeconds: number;
  idempotencyTtlSeconds: number;
  outboxRetentionSeconds: number;
  preflightSignedOutLimit: number;
  requiredApprovals: number;
  commentMaxChars: number;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(): AppConfig {
  const port = num("APP_PUBLIC_PORT", 4173);
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://localhost:5432/tinework",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "tinework",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    smtp: { host: process.env.SMTP_HOST ?? "localhost", port: num("SMTP_PORT", 1025) },
    mailFrom: process.env.MAIL_FROM ?? "Tinework <noreply@tinework.example>",
    valkeyUrl: process.env.VALKEY_URL ?? "redis://localhost:6379/0",
    valkeyKeyPrefix: process.env.VALKEY_KEY_PREFIX ?? "tinework:",
    publicPort: port,
    publicUrl: process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
    evalDebounceMs: num("EVAL_DEBOUNCE_MS", 400),
    slowEvalNoticeMs: num("SLOW_EVAL_NOTICE_MS", 3000),
    evalTimeoutMs: num("EVAL_TIMEOUT_MS", 8000),
    verifyTokenTtlSeconds: num("VERIFY_TOKEN_TTL_SECONDS", 3600),
    idempotencyTtlSeconds: num("IDEMPOTENCY_TTL_SECONDS", 86400),
    outboxRetentionSeconds: num("OUTBOX_RETENTION_SECONDS", 900),
    preflightSignedOutLimit: num("PREFLIGHT_SIGNED_OUT_LIMIT", 1),
    requiredApprovals: num("REQUIRED_APPROVALS", 2),
    commentMaxChars: num("COMMENT_MAX_CHARS", 500),
  };
}

/** The public config that reaches the browser. */
export function publicConfig(c: AppConfig) {
  return {
    evalDebounceMs: c.evalDebounceMs,
    slowEvalNoticeMs: c.slowEvalNoticeMs,
    commentMaxChars: c.commentMaxChars,
    requiredApprovals: c.requiredApprovals,
    preflightSignedOutLimit: c.preflightSignedOutLimit,
  };
}
