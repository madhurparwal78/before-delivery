import { readFileSync } from 'node:fs';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const publicPort = int('APP_PUBLIC_PORT', 4173);

export const env = {
  databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/ceibo'),
  pocketbaseUrl: str('POCKETBASE_URL', 'http://localhost:8090'),
  pocketbaseAdminEmail: str('POCKETBASE_ADMIN_EMAIL', ''),
  pocketbaseAdminPassword: str('POCKETBASE_ADMIN_PASSWORD', ''),
  s3: {
    endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', 'ceibo'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  killbill: {
    url: str('KILLBILL_URL', 'http://localhost:8080'),
    username: str('KILLBILL_USERNAME', 'admin'),
    password: str('KILLBILL_PASSWORD', ''),
    apiKey: str('KILLBILL_API_KEY', ''),
    apiSecret: str('KILLBILL_API_SECRET', ''),
  },
  smtp: {
    host: str('SMTP_HOST', 'localhost'),
    port: int('SMTP_PORT', 1025),
  },
  mailpitUrl: str('MAILPIT_URL', 'http://localhost:8025'),
  mailFrom: str('MAIL_FROM', 'Ceibo <orders@ceibo.test>'),
  appPublicUrl: str('APP_PUBLIC_URL', `http://127.0.0.1:${publicPort}`),
  publicPort,
  holdSeconds: int('HOLD_SECONDS', 900),
  dunningDaySeconds: int('DUNNING_DAY_SECONDS', 86400),
  changeCutoffHours: int('CHANGE_CUTOFF_HOURS', 48),
} as const;

export function databaseName(): string {
  const url = env.databaseUrl;
  const path = url.slice(url.lastIndexOf('/') + 1);
  return path.split('?')[0] || 'gf_dev';
}

const rawConfig = readFileSync(new URL('../../run.json', import.meta.url), 'utf8');
const manifest = JSON.parse(rawConfig) as { _schema?: string; install?: string; build?: string; serve?: string };
if (manifest._schema !== 'run-manifest-v1' || !manifest.install || !manifest.build || !manifest.serve) {
  throw new Error('run.json must be a run-manifest-v1 manifest with install, build and serve');
}
