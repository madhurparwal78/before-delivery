function req(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function opt(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

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
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  mail: { host: string; port: number; from: string };
  port: number;
  jobRunSeconds: number;
  leaseSeconds: number;
  retentionDaySeconds: number;
  webhookRetryBaseSeconds: number;
  outboundAllowedHosts: readonly string[];
}

export const config: Config = {
  databaseUrl: req('DATABASE_URL'),
  s3: {
    endpoint: req('S3_ENDPOINT').replace(/\/+$/, ''),
    region: opt('S3_REGION', 'us-east-1'),
    bucket: req('S3_BUCKET'),
    forcePathStyle: opt('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: req('S3_ACCESS_KEY_ID'),
    secretAccessKey: req('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: req('KILLBILL_URL').replace(/\/+$/, ''),
    username: req('KILLBILL_USERNAME'),
    password: req('KILLBILL_PASSWORD'),
    apiKey: req('KILLBILL_API_KEY'),
    apiSecret: req('KILLBILL_API_SECRET'),
  },
  mail: { host: req('SMTP_HOST'), port: int('SMTP_PORT', 1025, 1, 65535), from: req('MAIL_FROM') },
  port: int('APP_PUBLIC_PORT', 4173, 1, 65535),
  jobRunSeconds: int('JOB_RUN_SECONDS', 8, 1, 600),
  leaseSeconds: int('LEASE_SECONDS', 30, 1, 86400),
  retentionDaySeconds: int('RETENTION_DAY_SECONDS', 86400, 1, 86400),
  webhookRetryBaseSeconds: int('WEBHOOK_RETRY_BASE_SECONDS', 2, 1, 3600),
  outboundAllowedHosts: opt('OUTBOUND_ALLOWED_HOSTS', '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0),
};

export const JSON_BODY_LIMIT = 65536;
export const UPLOAD_LIMIT = 10000000;
export const SIGNED_LINK_SECONDS = 300;
export const MAX_ENDPOINTS_PER_TEAM = 5;
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
