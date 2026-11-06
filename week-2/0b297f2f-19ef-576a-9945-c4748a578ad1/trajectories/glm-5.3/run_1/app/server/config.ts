import { readEnv, requireEnv } from './util.js';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  publicBaseUrl: string;
  publishDelaySeconds: number | null;
}

export function loadConfig(): AppConfig {
  const port = readEnv('APP_PUBLIC_PORT') ? Number(readEnv('APP_PUBLIC_PORT')) : 4173;
  const publicUrl = readEnv('APP_PUBLIC_URL') ?? `http://localhost:${port}`;
  const delay = readEnv('PREVIEW_PUBLISH_DELAY_SECONDS');
  return {
    port,
    databaseUrl: requireEnv('DATABASE_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: (readEnv('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: requireEnv('SMTP_HOST'),
      port: Number(requireEnv('SMTP_PORT')),
      from: requireEnv('MAIL_FROM'),
    },
    publicBaseUrl: publicUrl.replace(/\/$/, ''),
    publishDelaySeconds: delay !== undefined && delay !== '' ? Number(delay) : null,
  };
}
