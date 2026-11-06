/** Every service credential and address is read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing configuration: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function numeric(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: optional('S3_ENDPOINT', 'http://localhost:9000'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: optional('S3_BUCKET', 'swathdeck'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: {
    host: optional('SMTP_HOST', 'localhost'),
    port: Math.trunc(numeric('SMTP_PORT', 1025)),
  },
  mailFrom: optional('MAIL_FROM', 'Swathdeck <alerts@fathomwright.test>'),
  port: Math.trunc(numeric('APP_PUBLIC_PORT', 4173)),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  escalationSeconds: numeric('ESCALATION_SECONDS', 300),
  signInWindowSeconds: numeric('SIGN_IN_WINDOW_SECONDS', 900),
} as const;

export const SESSION_HOURS = 12;
export const JSON_BODY_LIMIT = 64_000;
export const FILE_BODY_LIMIT = 50_000_000;
export const RESUMABLE_THRESHOLD = 8_000_000;
export const UPLOAD_PART_BYTES = 4_000_000;
