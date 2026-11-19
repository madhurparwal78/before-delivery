function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback === undefined) throw new Error(`${name} is not set`);
    return fallback;
  }
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return parsed;
}

export const config = {
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: text('SMTP_HOST'),
    port: Number(text('SMTP_PORT', '1025')),
    from: text('MAIL_FROM', 'Fio Contado Desk <desk@fio-contado.example>'),
  },
  wiremockUrl: text('WIREMOCK_URL'),
  gotenbergUrl: text('GOTENBERG_URL'),
  publicUrl: text('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/$/, ''),
  port: Number(text('APP_PUBLIC_PORT', '4173')),
  sessionSeconds: whole('SESSION_SECONDS', 28800),
  answerPageSeconds: whole('ANSWER_PAGE_SECONDS', 1209600),
  signOffPageSeconds: whole('SIGN_OFF_PAGE_SECONDS', 1209600),
  reminderAfterSeconds: whole('REMINDER_AFTER_SECONDS', 604800),
  requestRateWindowSeconds: whole('REQUEST_RATE_WINDOW_SECONDS', 3600),
  fileRateWindowSeconds: whole('FILE_RATE_WINDOW_SECONDS', 3600),
  closureWaitSeconds: whole('CLOSURE_WAIT_SECONDS', 2592000),
} as const;

export const SESSION_COOKIE = 'fioSession';
export const REQUEST_RATE_LIMIT = 20;
export const FILE_RATE_LIMIT = 5;
export const PROVIDER_TIMEOUT_MS = 5000;
export const JSON_BODY_LIMIT = 1_000_000;
export const EVIDENCE_FILE_LIMIT = 5_000_000;
export const EVIDENCE_REQUEST_LIMIT = 10_000_000;
export const STYLE_PAGE_SIZE = 25;
