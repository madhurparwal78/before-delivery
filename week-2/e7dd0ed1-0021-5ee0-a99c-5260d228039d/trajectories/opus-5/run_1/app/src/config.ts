import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function seconds(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const secretKeyFile = path.join(process.cwd(), '.farshore-sealing-key');

function loadSecretKey(): Buffer {
  const fromEnv = env('FARSHORE_SECRET_KEY');
  if (fromEnv !== undefined) return crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
  if (fs.existsSync(secretKeyFile)) {
    return Buffer.from(fs.readFileSync(secretKeyFile, 'utf8').trim(), 'hex');
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(secretKeyFile, generated.toString('hex'), { mode: 0o600 });
  fs.chmodSync(secretKeyFile, 0o600);
  return generated;
}

export const config = {
  port: Number(env('APP_PUBLIC_PORT') ?? 4173),
  databaseUrl: env('DATABASE_URL') ?? 'postgresql://localhost:5432/postgres',
  s3: {
    endpoint: env('S3_ENDPOINT') ?? 'http://localhost:9000',
    region: env('S3_REGION') ?? 'us-east-1',
    bucket: env('S3_BUCKET') ?? 'farshore',
    forcePathStyle: (env('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
    accessKeyId: env('S3_ACCESS_KEY_ID') ?? '',
    secretAccessKey: env('S3_SECRET_ACCESS_KEY') ?? '',
  },
  killbill: {
    url: env('KILLBILL_URL') ?? 'http://localhost:8080',
    username: env('KILLBILL_USERNAME') ?? 'admin',
    password: env('KILLBILL_PASSWORD') ?? 'password',
    apiKey: env('KILLBILL_API_KEY') ?? '',
    apiSecret: env('KILLBILL_API_SECRET') ?? '',
  },
  mail: {
    host: env('SMTP_HOST') ?? 'localhost',
    port: Number(env('SMTP_PORT') ?? 1025),
    from: env('MAIL_FROM') ?? 'Farshore <no-reply@farshore.test>',
  },
  secretKey: loadSecretKey(),
  timing: {
    inviteTtl: seconds('FARSHORE_INVITE_TTL_SECONDS', 259200),
    signinWindow: seconds('FARSHORE_SIGNIN_WINDOW_SECONDS', 900),
    billingSync: seconds('FARSHORE_BILLING_SYNC_SECONDS', 60),
    idempotencyTtl: seconds('FARSHORE_IDEMPOTENCY_TTL_SECONDS', 86400),
    day: seconds('FARSHORE_DAY_SECONDS', 86400),
    lifecycleSweep: seconds('FARSHORE_LIFECYCLE_SWEEP_SECONDS', 60),
    webhookBackoff: seconds('FARSHORE_WEBHOOK_BACKOFF_SECONDS', 10),
    undo: seconds('FARSHORE_UNDO_SECONDS', 30),
    twoStepPending: seconds('FARSHORE_TWO_STEP_PENDING_SECONDS', 300),
    stepUp: seconds('FARSHORE_STEP_UP_SECONDS', 300),
    sessionIdle: seconds('FARSHORE_SESSION_IDLE_SECONDS', 1800),
    sessionLifetime: seconds('FARSHORE_SESSION_LIFETIME_SECONDS', 43200),
    keyRotationOverlap: seconds('FARSHORE_KEY_ROTATION_OVERLAP_SECONDS', 86400),
  },
};

export const limits = {
  jsonBody: 65536,
  singleUpload: 50000000,
  multipartTotal: 1000000000,
  partMax: 16777216,
  partMin: 5242880,
  deleteObjectsBody: 2097152,
  metadataBytes: 2048,
  maxTags: 10,
  pageMax: 1000,
  scanBudget: 10000,
  webhookEndpoints: 5,
};
