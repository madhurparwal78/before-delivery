// Every service address, credential and timer is read here, once, at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(required('SMTP_PORT')),
  mailFrom: required('MAIL_FROM'),
  mailAddress: /<(.+)>/.exec(required('MAIL_FROM'))?.[1] ?? required('MAIL_FROM'),
  wiremockUrl: required('WIREMOCK_URL').replace(/\/$/, ''),
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/$/, ''),
  port: seconds('APP_PUBLIC_PORT', 4173),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/$/, ''),
  sessionSeconds: seconds('SESSION_SECONDS', 28800),
  undoSeconds: seconds('UNDO_SECONDS', 10),
  cueCacheSeconds: seconds('CUE_CACHE_SECONDS', 300),
  reviewPageSeconds: seconds('REVIEW_PAGE_SECONDS', 1209600),
  signOffPageSeconds: seconds('SIGN_OFF_PAGE_SECONDS', 1209600),
  feePageSeconds: seconds('FEE_PAGE_SECONDS', 1209600),
  reminderAfterSeconds: seconds('REMINDER_AFTER_SECONDS', 604800),
  enquiryRateWindowSeconds: seconds('ENQUIRY_RATE_WINDOW_SECONDS', 3600),
  reviewLinkRateWindowSeconds: seconds('REVIEW_LINK_RATE_WINDOW_SECONDS', 3600),
  fileRateWindowSeconds: seconds('FILE_RATE_WINDOW_SECONDS', 3600),
  closureWaitSeconds: seconds('CLOSURE_WAIT_SECONDS', 2592000),
};
