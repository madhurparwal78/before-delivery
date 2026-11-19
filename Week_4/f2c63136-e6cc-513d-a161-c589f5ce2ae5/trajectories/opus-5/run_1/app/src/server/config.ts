function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtpHost: string;
  smtpPort: number;
  mailpitUrl: string;
  appPublicUrl: string;
  port: number;
  gradingKey: string;
  workspaceTimeZone: string;
  checkTimeoutSeconds: number;
  queueStepSeconds: number;
  diffContextLines: number;
  pushSizeLimitBytes: number;
  diffBreakpointPx: number;
  liveUpdateDelayMs: number;
  mailFrom: string;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number.parseInt(required('SMTP_PORT'), 10),
  mailpitUrl: required('MAILPIT_URL'),
  appPublicUrl: required('APP_PUBLIC_URL'),
  port: int('APP_PUBLIC_PORT', 4173),
  gradingKey: str('GRADING_KEY', 'gk-ridgestack-7d3a91c4'),
  workspaceTimeZone: str('WORKSPACE_TIME_ZONE', 'America/Denver'),
  checkTimeoutSeconds: int('CHECK_TIMEOUT_SECONDS', 600),
  queueStepSeconds: int('QUEUE_STEP_SECONDS', 30),
  diffContextLines: int('DIFF_CONTEXT_LINES', 3),
  pushSizeLimitBytes: int('PUSH_SIZE_LIMIT_BYTES', 65536),
  diffBreakpointPx: int('DIFF_BREAKPOINT_PX', 768),
  liveUpdateDelayMs: int('LIVE_UPDATE_DELAY_MS', 250),
  mailFrom: str('MAIL_FROM', 'Ridgestack <review@ridgestack.example>'),
};

export const JSON_SIZE_LIMIT_BYTES = 262144;
