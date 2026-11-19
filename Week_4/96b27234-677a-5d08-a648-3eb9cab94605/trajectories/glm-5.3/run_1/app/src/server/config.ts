// All configuration is read from the environment at start; nothing is
// hard-coded and nothing is sent to the browser.
import { createHash, randomBytes } from 'crypto';

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: num('SMTP_PORT', 1025),
  },
  mailFrom: process.env.MAIL_FROM ?? 'Hearthtile <hello@hearthtile.example>',
  valkeyUrl: process.env.VALKEY_URL ?? 'redis://127.0.0.1:6379',
  gradingKey: process.env.GRADING_KEY ?? '',
  publicPort: num('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? '',
  instanceName: process.env.INSTANCE_NAME ?? 'a',
  stepMinIntervalMs: num('STEP_MIN_INTERVAL_MS', 200),
  dropGraceSeconds: num('DROP_GRACE_SECONDS', 30),
  voteWindowSeconds: num('VOTE_WINDOW_SECONDS', 60),
  inviteTtlSeconds: num('INVITE_TTL_SECONDS', 604800),
  reminderLeadMinutes: num('REMINDER_LEAD_MINUTES', 60),
  chatMaxChars: num('CHAT_MAX_CHARS', 300),
  sessionCapacityMax: num('SESSION_CAPACITY_MAX', 50),
  jsonBodyLimit: 64000,
  setupBodyLimit: 1000000,
  multipartLimit: 51000000,
};

export function opaqueId(): string {
  return randomBytes(12).toString('base64url');
}

export function token(): string {
  return randomBytes(24).toString('base64url');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export const DEFAULT_WORLD = 'default';
