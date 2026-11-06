export interface AppConfig {
  port: number;
  publicUrl: string;
  instance: string;
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  meilisearch: { url: string; apiKey: string; index: string };
  queueRetrySeconds: number[];
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function readConfig(): AppConfig {
  const port = Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10);
  const retry = optional('QUEUE_RETRY_SECONDS', '30,120,600')
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(part => Number.isFinite(part) && part > 0);
  return {
    port,
    publicUrl: optional('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/$/, ''),
    instance: optional('STUDIO_INSTANCE', 'main'),
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number.parseInt(required('SMTP_PORT'), 10),
      from: required('MAIL_FROM'),
    },
    meilisearch: {
      url: required('MEILISEARCH_URL').replace(/\/$/, ''),
      apiKey: required('MEILISEARCH_API_KEY'),
      index: optional('MEILISEARCH_INDEX', 'models'),
    },
    queueRetrySeconds: retry.length > 0 ? retry : [30, 120, 600],
  };
}

export const config: AppConfig = readConfig();
