/** Every credential and setting the app reads from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive whole number of seconds`);
  }
  return parsed;
}

const port = Number(optional('APP_PUBLIC_PORT', '4173'));
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('APP_PUBLIC_PORT must be a valid port number');
}

export const config = {
  port,
  baseUrl: optional('APP_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '1025')),
  },
  tenderLinkTtlSeconds: seconds('TENDER_LINK_TTL_SECONDS', 1800),
  invitationTtlSeconds: seconds('INVITATION_TTL_SECONDS', 604800),
  sessionIdleTimeoutSeconds: seconds('SESSION_IDLE_TIMEOUT_SECONDS', 43200),
  enquiryRateWindowSeconds: seconds('ENQUIRY_RATE_WINDOW_SECONDS', 3600),
} as const;

export const MAIL_FROM_ADDRESS = 'plumbline@marrowhall.example';
export const MAIL_FROM = `Plumbline <${MAIL_FROM_ADDRESS}>`;
