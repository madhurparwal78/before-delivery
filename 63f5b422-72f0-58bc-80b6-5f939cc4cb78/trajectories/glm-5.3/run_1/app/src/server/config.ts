import fs from 'node:fs';

export interface Config {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number };
  mailFrom: string;
  publicUrl: string;
  publicPort: number;
  gradingRoutes: boolean;
  presenceTimeoutMs: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing required environment variable ${name}`); process.exit(1); }
  return v;
}

function boolEnv(v: string | undefined): boolean {
  return v === 'true' || v === '1' || v === 'yes';
}

const port = process.env.APP_PUBLIC_PORT ? Number(process.env.APP_PUBLIC_PORT) : 4173;

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: boolEnv(process.env.S3_FORCE_PATH_STYLE),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: Number(process.env.SMTP_PORT ?? 1025) },
  mailFrom: required('MAIL_FROM'),
  publicUrl: process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
  publicPort: port,
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  presenceTimeoutMs: Number(process.env.PRESENCE_TIMEOUT_MS ?? 30000),
};

export function readJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
