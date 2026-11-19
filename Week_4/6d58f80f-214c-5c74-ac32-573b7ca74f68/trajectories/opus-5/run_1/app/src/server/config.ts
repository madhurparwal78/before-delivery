import { randomBytes } from 'node:crypto';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

const number = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
};

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  pocketbase: {
    url: required('POCKETBASE_URL').replace(/\/+$/, ''),
    adminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    adminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
  },
  port: number('APP_PUBLIC_PORT', 4173),
  storageQuotaBytes: number('STORAGE_QUOTA_BYTES', 100_000_000_000),
  uploadPauseTtlSeconds: number('UPLOAD_PAUSE_TTL_SECONDS', 86_400),
  clockControl: process.env.LINTEL_CLOCK_CONTROL === 'on',
  linkKey: randomBytes(32),
} as const;

export const SEED_PASSWORD = 'Lintel-demo-2026!';
export const MAX_FILE_SIZE = 2_000_000_000;
export const MAX_JSON_BODY = 65_536;
export const MAX_PART_BODY = 5_242_880;
export const LINK_TTL_SECONDS = 60;
export const SESSION_COOKIE = 'lintel_session';
