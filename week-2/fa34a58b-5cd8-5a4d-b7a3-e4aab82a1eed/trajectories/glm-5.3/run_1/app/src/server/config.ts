import path from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
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
  smtp: { host: string; port: number };
  mailFrom: string;
  port: number;
}

export function readConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: required('S3_FORCE_PATH_STYLE') !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: { host: required('SMTP_HOST'), port: Number(required('SMTP_PORT')) },
    mailFrom: required('MAIL_FROM'),
    port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
  };
}

export const publicDir = path.resolve(process.cwd(), 'public');
