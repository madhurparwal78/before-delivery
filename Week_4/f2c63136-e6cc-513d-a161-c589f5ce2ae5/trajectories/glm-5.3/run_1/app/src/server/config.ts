/** All configuration is read here and only here; each default lives in this file. */
export interface AppConfig {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailpitUrl: string;
  appPublicUrl: string;
  appPublicPort: number;
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

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === '' ? def : Number(v);
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

export function readConfig(): AppConfig {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3Endpoint: required('S3_ENDPOINT'),
    s3Region: required('S3_REGION'),
    s3Bucket: required('S3_BUCKET'),
    s3ForcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: num('SMTP_PORT', 1025),
    mailpitUrl: required('MAILPIT_URL'),
    appPublicUrl: required('APP_PUBLIC_URL'),
    appPublicPort: num('APP_PUBLIC_PORT', 4173),
    gradingKey: str('GRADING_KEY', 'gk-ridgestack-7d3a91c4'),
    workspaceTimeZone: str('WORKSPACE_TIME_ZONE', 'America/Denver'),
    checkTimeoutSeconds: num('CHECK_TIMEOUT_SECONDS', 600),
    queueStepSeconds: num('QUEUE_STEP_SECONDS', 30),
    diffContextLines: num('DIFF_CONTEXT_LINES', 3),
    pushSizeLimitBytes: num('PUSH_SIZE_LIMIT_BYTES', 65536),
    diffBreakpointPx: num('DIFF_BREAKPOINT_PX', 768),
    liveUpdateDelayMs: num('LIVE_UPDATE_DELAY_MS', 250),
    mailFrom: str('MAIL_FROM', 'Ridgestack <review@ridgestack.example>'),
  };
}
