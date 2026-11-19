/**
 * Every service address and credential is read here at start. None of these values ever
 * reaches the browser bundle.
 */

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

function milliseconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of milliseconds`);
  }
  return Math.floor(value);
}

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: {
    host: string;
    port: number;
    from: string;
  };
  gradingRoutes: boolean;
  presenceTimeoutMs: number;
  versionIntervalMs: number;
  inviteTtlMs: number;
}

export const config: Config = {
  port: Number(optional('APP_PUBLIC_PORT', '4173')),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '1025')),
    from: required('MAIL_FROM'),
  },
  gradingRoutes: process.env['GRADING_ROUTES'] === 'on',
  presenceTimeoutMs: milliseconds('PRESENCE_TIMEOUT_MS', 30000),
  versionIntervalMs: milliseconds('VERSION_INTERVAL_MS', 300000),
  inviteTtlMs: milliseconds('INVITE_TTL_MS', 604800000),
};
