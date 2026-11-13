/** The only reader of the environment. Every credential, timer and limit of the product comes through here. */
import type { Seeds } from '../shared/types';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Environment variable ${name} must be a whole number`);
  return parsed;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: whole('SMTP_PORT', 1025) },
  mailpitUrl: required('MAILPIT_URL').replace(/\/$/, ''),
  mailFrom: required('MAIL_FROM'),
  /** Empty means the grading routes answer 404 for everyone. */
  gradingKey: process.env['GRADING_KEY'] ?? '',
  startAt: text('APP_START_AT', '2026-11-06T10:00:00Z'),
  timeZone: text('APP_TIME_ZONE', 'Europe/Lisbon'),
  autosaveMs: whole('AUTOSAVE_MS', 800),
  undoLimit: whole('UNDO_LIMIT', 100),
  lockTimeoutSeconds: whole('LOCK_TIMEOUT_SECONDS', 30),
  publishLimit: whole('PUBLISH_LIMIT', 20),
  embedPollSeconds: whole('EMBED_POLL_SECONDS', 30),
  inviteTtlHours: whole('INVITE_TTL_HOURS', 72),
  imageMaxBytes: whole('IMAGE_MAX_BYTES', 1048576),
  imageMaxDimension: whole('IMAGE_MAX_DIMENSION', 2048),
  modelMaxBytes: whole('MODEL_MAX_BYTES', 2097152),
  modelMaxVertices: whole('MODEL_MAX_VERTICES', 50000),
  particleMax: whole('PARTICLE_MAX', 2000),
  seeds: {
    particle: whole('PARTICLE_SEED', 7),
    cloth: whole('CLOTH_SEED', 3),
    grain: whole('GRAIN_SEED', 11),
  } satisfies Seeds,
} as const;

export const JSON_BODY_LIMIT = 1_048_576;
export const UPLOAD_BODY_LIMIT = 10_485_760;
export const PURGE_DAYS = 30;
