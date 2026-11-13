import { join } from 'node:path';

const text = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const whole = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
};

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  databaseUrl: text('DATABASE_URL'),
  valkeyUrl: text('VALKEY_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: text('SMTP_HOST'), port: whole('SMTP_PORT', 1025) },
  mailFrom: process.env['MAIL_FROM'] || 'Overcall <scorers@overcall.test>',
  gradingKey: text('GRADING_KEY'),
  appBaseUrl: (process.env['APP_BASE_URL'] || process.env['APP_PUBLIC_URL'] || `http://localhost:${port}`).replace(/\/+$/, ''),
  timeZone: process.env['APP_TZ'] || 'Asia/Kolkata',
  liveDelayMs: whole('LIVE_DELAY_MS', 3000),
  penGraceMs: whole('PEN_GRACE_MS', 2000),
  tickMs: whole('TICK_MS', 260),
  tickStaggerMs: whole('TICK_STAGGER_MS', 80),
  superOverMax: whole('SUPER_OVER_MAX', 2),
  inviteTtlHours: whole('INVITE_TTL_HOURS', 48),
  inviteRatePerHour: whole('INVITE_RATE_PER_HOUR', 20),
  logoMaxBytes: whole('LOGO_MAX_BYTES', 1048576),
  clientDir: join(import.meta.dirname, 'client'),
} as const;

/** The service status route checks every service live, within one second each. */
export const SERVICE_PING_MS = 1_000;
export const JSON_LIMIT_BYTES = 65536;
export const SEED_LIMIT_BYTES = 1048576;
export const MULTIPART_OVERHEAD_BYTES = 65536;
