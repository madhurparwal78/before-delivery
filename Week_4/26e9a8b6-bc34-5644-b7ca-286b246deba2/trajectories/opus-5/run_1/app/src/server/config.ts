import { LIMIT_DEFAULTS, LIMIT_NAMES, type Limits } from '../shared/limits.js';

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
  smtp: { host: string; port: number; mailFrom: string };
  publicUrl: string;
  port: number;
  gradingRoutes: boolean;
  limits: Limits;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function readLimits(): Limits {
  const limits = { ...LIMIT_DEFAULTS } as Limits;
  for (const name of LIMIT_NAMES) {
    const raw = process.env[name.toUpperCase()];
    if (raw === undefined || raw === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) limits[name] = parsed;
  }
  return limits;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number(process.env['SMTP_PORT'] ?? 1025),
      mailFrom: required('MAIL_FROM'),
    },
    publicUrl: process.env['APP_PUBLIC_URL'] ?? 'http://127.0.0.1:4173',
    port: Number(process.env['APP_PUBLIC_PORT'] ?? 4173),
    gradingRoutes: process.env['GRADING_ROUTES'] === 'on',
    limits: readLimits(),
  };
}

export const config = loadConfig();
