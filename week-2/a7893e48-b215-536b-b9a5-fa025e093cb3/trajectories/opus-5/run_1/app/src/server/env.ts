import { randomBytes } from 'node:crypto';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`environment variable ${name} is not a number`);
  return value;
}

export interface Env {
  port: number;
  databaseUrl: string;
  holdTtlSeconds: number;
  binderLinkTtlSeconds: number;
  sessionSecret: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
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
}

export const env: Env = {
  port: numeric('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  holdTtlSeconds: numeric('HOLD_TTL_SECONDS', 600),
  binderLinkTtlSeconds: numeric('BINDER_LINK_TTL_SECONDS', 604800),
  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: numeric('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
};
