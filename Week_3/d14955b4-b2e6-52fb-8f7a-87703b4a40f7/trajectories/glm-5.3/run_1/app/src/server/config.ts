import crypto from 'node:crypto';

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
  wiremockUrl: string;
  port: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  webhookNonceTtlSeconds: number;
  idempotencyKeyTtlSeconds: number;
  secretOverlapSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  cached = {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION || 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    wiremockUrl: required('WIREMOCK_URL'),
    port: integer('APP_PUBLIC_PORT', 4173),
    accessTokenTtlSeconds: integer('ACCESS_TOKEN_TTL_SECONDS', 600),
    refreshTokenTtlSeconds: integer('REFRESH_FAMILY_TTL_SECONDS', 1_209_600),
    webhookNonceTtlSeconds: integer('WEBHOOK_NONCE_TTL_SECONDS', 600),
    idempotencyKeyTtlSeconds: integer('IDEMPOTENCY_KEY_TTL_SECONDS', 86_400),
    secretOverlapSeconds: integer('SECRET_OVERLAP_SECONDS', 600),
  };
  return cached;
}
