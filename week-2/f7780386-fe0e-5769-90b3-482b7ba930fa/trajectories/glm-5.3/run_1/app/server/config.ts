// Every credential and URL is read from the environment, once at start.
// No value is hard-coded, logged, written to the browser bundle or returned.

export interface Config {
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  publicPort: number;
  holdSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return n;
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  cached = {
    databaseUrl: required('DATABASE_URL'),
    killbillUrl: required('KILLBILL_URL'),
    killbillUsername: required('KILLBILL_USERNAME'),
    killbillPassword: required('KILLBILL_PASSWORD'),
    killbillApiKey: required('KILLBILL_API_KEY'),
    killbillApiSecret: required('KILLBILL_API_SECRET'),
    s3Endpoint: required('S3_ENDPOINT'),
    s3Region: required('S3_REGION'),
    s3Bucket: required('S3_BUCKET'),
    s3ForcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: optionalNumber('SMTP_PORT', 1025),
    publicPort: optionalNumber('APP_PUBLIC_PORT', 4173),
    holdSeconds: optionalNumber('PASSBOARD_HOLD_SECONDS', 600),
  };
  return cached;
}
