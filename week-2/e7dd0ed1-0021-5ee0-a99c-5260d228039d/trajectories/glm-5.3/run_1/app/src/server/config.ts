import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadSecretKey(): Buffer {
  const fromEnv = process.env.FARSHORE_SECRET_KEY;
  if (fromEnv !== undefined && fromEnv !== '') return Buffer.from(fromEnv, 'utf8');
  const file = join(process.cwd(), '.farshore-secret-key');
  if (existsSync(file)) {
    const k = readFileSync(file);
    if (k.length >= 32) return k;
  }
  const k = randomBytes(32);
  writeFileSync(file, k, { mode: 0o600 });
  chmodSync(file, 0o600);
  return k;
}

export const config = {
  port: envInt('APP_PUBLIC_PORT', 4173),
  databaseUrl: envStr('DATABASE_URL', 'postgresql://localhost:5432/farshore'),
  s3: {
    endpoint: envStr('S3_ENDPOINT', 'http://localhost:9000'),
    region: envStr('S3_REGION', 'us-east-1'),
    bucket: envStr('S3_BUCKET', 'farshore'),
    forcePathStyle: envStr('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: envStr('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: envStr('S3_SECRET_ACCESS_KEY', ''),
  },
  killbill: {
    url: envStr('KILLBILL_URL', 'http://localhost:8080').replace(/\/$/, ''),
    username: envStr('KILLBILL_USERNAME', 'admin'),
    password: envStr('KILLBILL_PASSWORD', 'password'),
    apiKey: envStr('KILLBILL_API_KEY', ''),
    apiSecret: envStr('KILLBILL_API_SECRET', ''),
  },
  mail: {
    host: envStr('SMTP_HOST', 'localhost'),
    port: envInt('SMTP_PORT', 1025),
    from: envStr('MAIL_FROM', 'Farshore <no-reply@farshore.test>'),
  },
  get secretKey(): Buffer { return loadSecretKey(); },
  timing: {
    inviteTtl: envInt('FARSHORE_INVITE_TTL_SECONDS', 259_200),
    signinWindow: envInt('FARSHORE_SIGNIN_WINDOW_SECONDS', 900),
    billingSync: envInt('FARSHORE_BILLING_SYNC_SECONDS', 60),
    idempotencyTtl: envInt('FARSHORE_IDEMPOTENCY_TTL_SECONDS', 86_400),
    day: envInt('FARSHORE_DAY_SECONDS', 86_400),
    lifecycleSweep: envInt('FARSHORE_LIFECYCLE_SWEEP_SECONDS', 60),
    webhookBackoff: envInt('FARSHORE_WEBHOOK_BACKOFF_SECONDS', 10),
    undo: envInt('FARSHORE_UNDO_SECONDS', 30),
    twoStepPending: envInt('FARSHORE_TWO_STEP_PENDING_SECONDS', 300),
    stepUp: envInt('FARSHORE_STEP_UP_SECONDS', 300),
    sessionIdle: envInt('FARSHORE_SESSION_IDLE_SECONDS', 1_800),
    sessionLifetime: envInt('FARSHORE_SESSION_LIFETIME_SECONDS', 43_200),
    keyOverlap: envInt('FARSHORE_KEY_ROTATION_OVERLAP_SECONDS', 86_400),
  },
};

export type Config = typeof config;
