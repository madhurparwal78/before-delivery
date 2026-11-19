function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: str('DATABASE_URL', 'postgresql://postgres@127.0.0.1:5432/postgres'),
  s3: {
    endpoint: str('S3_ENDPOINT', 'http://127.0.0.1:9000'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', 'switchyard'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: {
    host: str('SMTP_HOST', '127.0.0.1'),
    port: int('SMTP_PORT', 1025),
  },
  mailpitUrl: str('MAILPIT_URL', 'http://127.0.0.1:8025'),
  mailFrom: str('MAIL_FROM', 'Pinbyte Switchyard <runs@switchyard.example>'),
  port: int('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', `http://127.0.0.1:${int('APP_PUBLIC_PORT', 4173)}`),
  gradingKey: str('GRADING_KEY', 'gk-switchyard-4c9e27b1'),
  timeZone: str('WORKSPACE_TIME_ZONE', 'America/New_York'),
  retryCount: int('RETRY_COUNT', 2),
  retryDelaySeconds: int('RETRY_DELAY_SECONDS', 30),
  stepLimit: int('STEP_LIMIT', 40),
  waitMaxSeconds: int('WAIT_MAX_SECONDS', 86400),
  webhookBodyLimitBytes: int('WEBHOOK_BODY_LIMIT_BYTES', 4096),
  idempotencyWindowSeconds: int('IDEMPOTENCY_WINDOW_SECONDS', 600),
  editHoldSeconds: int('EDIT_HOLD_SECONDS', 20),
  scheduleTickSeconds: int('SCHEDULE_TICK_SECONDS', 1),
  canvasBreakpointPx: int('CANVAS_BREAKPOINT_PX', 720),
} as const;

export const JSON_BODY_LIMIT_BYTES = 65536;
export const IMPORT_BODY_LIMIT_BYTES = 262144;
export const MAX_JSON_DEPTH = 20;
export const MAX_NAME_CHARS = 60;
export const SESSION_COOKIE = 'switchyard_session';

/** An instance's identity is the port it is bound to. */
export const instancePort = config.port;
