// The only place that reads the environment. Defaults here are the published ones; service
// credentials and URLs have none and the server refuses to start without them.

const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function text(name: string, fallback: string): string {
  return env[name] || fallback;
}

function whole(name: string, fallback: number): number {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: whole('SMTP_PORT', 1025) },
  mailpitUrl: required('MAILPIT_URL').replace(/\/$/, ''),
  gradingKey: text('GRADING_KEY', 'gk-ridgestack-7d3a91c4'),
  timeZone: text('WORKSPACE_TIME_ZONE', 'America/Denver'),
  checkTimeoutSeconds: whole('CHECK_TIMEOUT_SECONDS', 600),
  queueStepSeconds: whole('QUEUE_STEP_SECONDS', 30),
  diffContextLines: whole('DIFF_CONTEXT_LINES', 3),
  pushSizeLimitBytes: whole('PUSH_SIZE_LIMIT_BYTES', 65536),
  diffBreakpointPx: whole('DIFF_BREAKPOINT_PX', 768),
  liveUpdateDelayMs: whole('LIVE_UPDATE_DELAY_MS', 250),
  mailFrom: text('MAIL_FROM', 'Ridgestack <review@ridgestack.example>'),
  jsonLimitBytes: 262144,
};
