import { setSeedDefaults, clearPropCaches } from '../shared/properties';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

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
  smtp: { host: string; port: number; mailpitUrl: string; from: string };
  gradingKey: string;
  startAt: string;
  timeZone: string;
  autosaveMs: number;
  undoLimit: number;
  lockTimeoutSeconds: number;
  publishLimit: number;
  embedPollSeconds: number;
  inviteTtlHours: number;
  imageMaxBytes: number;
  imageMaxDimension: number;
  modelMaxBytes: number;
  modelMaxVertices: number;
  particleMax: number;
  particleSeed: number;
  clothSeed: number;
  grainSeed: number;
}

export const config: Config = {
  port: integer('APP_PUBLIC_PORT', 4173),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    mailpitUrl: optional('MAILPIT_URL', ''),
    from: optional('MAIL_FROM', 'Halation Studio <studio@tinderbox-optics.test>'),
  },
  gradingKey: optional('GRADING_KEY', ''),
  startAt: optional('APP_START_AT', '2026-11-06T10:00:00Z'),
  timeZone: optional('APP_TIME_ZONE', 'Europe/Lisbon'),
  autosaveMs: integer('AUTOSAVE_MS', 800),
  undoLimit: integer('UNDO_LIMIT', 100),
  lockTimeoutSeconds: integer('LOCK_TIMEOUT_SECONDS', 30),
  publishLimit: integer('PUBLISH_LIMIT', 20),
  embedPollSeconds: integer('EMBED_POLL_SECONDS', 30),
  inviteTtlHours: integer('INVITE_TTL_HOURS', 72),
  imageMaxBytes: integer('IMAGE_MAX_BYTES', 1048576),
  imageMaxDimension: integer('IMAGE_MAX_DIMENSION', 2048),
  modelMaxBytes: integer('MODEL_MAX_BYTES', 2097152),
  modelMaxVertices: integer('MODEL_MAX_VERTICES', 50000),
  particleMax: integer('PARTICLE_MAX', 2000),
  particleSeed: integer('PARTICLE_SEED', 7),
  clothSeed: integer('CLOTH_SEED', 3),
  grainSeed: integer('GRAIN_SEED', 11),
};

setSeedDefaults({
  particle: config.particleSeed,
  cloth: config.clothSeed,
  grain: config.grainSeed,
});
clearPropCaches();

/** Non-secret settings the browser needs to behave as published. */
export interface ClientConfig {
  autosaveMs: number;
  undoLimit: number;
  lockTimeoutSeconds: number;
  publishLimit: number;
  embedPollSeconds: number;
  inviteTtlHours: number;
  imageMaxBytes: number;
  imageMaxDimension: number;
  modelMaxBytes: number;
  modelMaxVertices: number;
  particleMax: number;
  particleSeed: number;
  clothSeed: number;
  grainSeed: number;
  timeZone: string;
  publicUrl: string;
}

export function clientConfig(): ClientConfig {
  return {
    autosaveMs: config.autosaveMs,
    undoLimit: config.undoLimit,
    lockTimeoutSeconds: config.lockTimeoutSeconds,
    publishLimit: config.publishLimit,
    embedPollSeconds: config.embedPollSeconds,
    inviteTtlHours: config.inviteTtlHours,
    imageMaxBytes: config.imageMaxBytes,
    imageMaxDimension: config.imageMaxDimension,
    modelMaxBytes: config.modelMaxBytes,
    modelMaxVertices: config.modelMaxVertices,
    particleMax: config.particleMax,
    particleSeed: config.particleSeed,
    clothSeed: config.clothSeed,
    grainSeed: config.grainSeed,
    timeZone: config.timeZone,
    publicUrl: config.publicUrl,
  };
}
