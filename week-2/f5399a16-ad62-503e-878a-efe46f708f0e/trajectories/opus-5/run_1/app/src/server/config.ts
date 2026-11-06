/** Every service credential and address is read from its environment variable at start. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  wiremockUrl: required('WIREMOCK_URL'),
  gotenbergUrl: required('GOTENBERG_URL'),
  publicPort: Number(process.env['APP_PUBLIC_PORT'] ?? '4173'),
  publicUrl: required('APP_PUBLIC_URL'),
  timers: {
    sessionSeconds: seconds('SESSION_SECONDS', 28800),
    undoSeconds: seconds('UNDO_SECONDS', 10),
    cueCacheSeconds: seconds('CUE_CACHE_SECONDS', 300),
    reviewPageSeconds: seconds('REVIEW_PAGE_SECONDS', 1209600),
    signOffPageSeconds: seconds('SIGN_OFF_PAGE_SECONDS', 1209600),
    feePageSeconds: seconds('FEE_PAGE_SECONDS', 1209600),
    reminderAfterSeconds: seconds('REMINDER_AFTER_SECONDS', 604800),
    reviewLinkWindowSeconds: seconds('REVIEW_LINK_RATE_WINDOW_SECONDS', 3600),
    enquiryWindowSeconds: seconds('ENQUIRY_RATE_WINDOW_SECONDS', 3600),
    fileWindowSeconds: seconds('FILE_RATE_WINDOW_SECONDS', 3600),
    closureWaitSeconds: seconds('CLOSURE_WAIT_SECONDS', 2592000),
  },
} as const;

export const MAIL_ADDRESS = 'desk@noorbakkerboards.example';
export const JSON_BODY_LIMIT = 1_000_000;
export const UPLOAD_BODY_LIMIT = 9_000_000;
export const FILE_LIMIT = 8_000_000;
export const ATTACHMENT_LIMIT = 5_000_000;
export const PROVIDER_TIMEOUT_MS = 5000;
