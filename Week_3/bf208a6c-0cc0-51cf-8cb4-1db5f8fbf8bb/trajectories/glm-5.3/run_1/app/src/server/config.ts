import { readEnvInt } from './util.js';

export interface Config {
  port: number;
  publicUrl: string;
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
  ntfy: { url: string; username: string; password: string };
  gradingKey: string | null;
  uploadMaxBytes: number;
  verifyCodeTtl: number;
  inviteTtl: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function loadConfig(): Config {
  return {
    port: readEnvInt('APP_PUBLIC_PORT', 4173),
    publicUrl: (process.env.APP_PUBLIC_URL ?? '').replace(/\/$/, ''),
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: readEnvInt('SMTP_PORT', 25),
      from: required('MAIL_FROM'),
    },
    ntfy: {
      url: required('NTFY_URL'),
      username: required('NTFY_USERNAME'),
      password: required('NTFY_PASSWORD'),
    },
    gradingKey: process.env.GRADING_KEY ?? null,
    uploadMaxBytes: readEnvInt('UPLOAD_MAX_BYTES', 5_000_000),
    verifyCodeTtl: readEnvInt('VERIFY_CODE_TTL_SECONDS', 900),
    inviteTtl: readEnvInt('INVITE_TTL_SECONDS', 604_800),
  };
}
