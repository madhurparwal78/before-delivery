import { URL } from 'node:url';

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = Number.parseInt(text(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  instanceId: String(port),
  publicUrl: text('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL', ''),
  s3: {
    endpoint: text('S3_ENDPOINT', '').replace(/\/+$/, ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    pathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: { host: text('SMTP_HOST', ''), port: whole('SMTP_PORT', 1025) },
  mailFrom: text('MAIL_FROM', 'Pinbyte Switchyard <runs@switchyard.example>'),
  gradingKey: text('GRADING_KEY', 'gk-switchyard-4c9e27b1'),
  timeZone: text('WORKSPACE_TIME_ZONE', 'America/New_York'),
  retryCount: whole('RETRY_COUNT', 2),
  retryDelaySeconds: whole('RETRY_DELAY_SECONDS', 30),
  stepLimit: whole('STEP_LIMIT', 40),
  waitMaxSeconds: whole('WAIT_MAX_SECONDS', 86400),
  webhookBodyLimitBytes: whole('WEBHOOK_BODY_LIMIT_BYTES', 4096),
  idempotencyWindowSeconds: whole('IDEMPOTENCY_WINDOW_SECONDS', 600),
  editHoldSeconds: whole('EDIT_HOLD_SECONDS', 20),
  scheduleTickSeconds: whole('SCHEDULE_TICK_SECONDS', 1),
  canvasBreakpointPx: whole('CANVAS_BREAKPOINT_PX', 720),
} as const;

const own = new URL(config.publicUrl);

/** Host and port pairs a call-webhook step may reach: the public address, or loopback on the app's own port. */
export const ownAddresses: ReadonlySet<string> = new Set([
  `${own.hostname}:${own.port || '80'}`,
  `127.0.0.1:${config.port}`,
  `localhost:${config.port}`,
]);
