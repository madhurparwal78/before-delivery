function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  databaseUrl: text('DATABASE_URL', ''),
  s3: {
    endpoint: text('S3_ENDPOINT', ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: {
    host: text('SMTP_HOST', ''),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Tinework <noreply@tinework.example>'),
  },
  valkey: {
    url: text('VALKEY_URL', ''),
    prefix: text('VALKEY_KEY_PREFIX', 'tinework:'),
  },
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`),
  evalDebounceMs: whole('EVAL_DEBOUNCE_MS', 400),
  slowEvalNoticeMs: whole('SLOW_EVAL_NOTICE_MS', 3000),
  evalTimeoutMs: whole('EVAL_TIMEOUT_MS', 8000),
  verifyTokenTtlSeconds: whole('VERIFY_TOKEN_TTL_SECONDS', 3600),
  idempotencyTtlSeconds: whole('IDEMPOTENCY_TTL_SECONDS', 86400),
  outboxRetentionSeconds: whole('OUTBOX_RETENTION_SECONDS', 900),
  preflightSignedOutLimit: whole('PREFLIGHT_SIGNED_OUT_LIMIT', 1),
  requiredApprovals: whole('REQUIRED_APPROVALS', 2),
  commentMaxChars: whole('COMMENT_MAX_CHARS', 500),
} as const;

export const ENGINE_VERSION = 'tine-1.4.0';
export const BODY_LIMIT = 65536;
export const SETUP_BODY_LIMIT = 1000000;
export const PREFLIGHT_COUNTER_TTL_SECONDS = 86400;
export const COMPARE_VOXEL_MM = 0.5;
export const COMPARE_MAX_CELLS = 8000000;
export const MESSAGE_MAX_CHARS = 200;
