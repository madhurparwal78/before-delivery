// Configuration: every value comes from the environment, read once at start.
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
  smtp: {
    host: string;
    port: number;
    mailpitUrl: string;
    from: string;
  };
  gradingKey: string | null;
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

function intEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(): Config {
  return {
    port: intEnv('APP_PUBLIC_PORT', 4173),
    publicUrl: process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173',
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: intEnv('SMTP_PORT', 1025),
      mailpitUrl: process.env.MAILPIT_URL ?? '',
      from: process.env.MAIL_FROM ?? 'Halation Studio <studio@tinderbox-optics.test>',
    },
    gradingKey: process.env.GRADING_KEY ?? null,
    startAt: process.env.APP_START_AT ?? '2026-11-06T10:00:00Z',
    timeZone: process.env.APP_TIME_ZONE ?? 'Europe/Lisbon',
    autosaveMs: intEnv('AUTOSAVE_MS', 800),
    undoLimit: intEnv('UNDO_LIMIT', 100),
    lockTimeoutSeconds: intEnv('LOCK_TIMEOUT_SECONDS', 30),
    publishLimit: intEnv('PUBLISH_LIMIT', 20),
    embedPollSeconds: intEnv('EMBED_POLL_SECONDS', 30),
    inviteTtlHours: intEnv('INVITE_TTL_HOURS', 72),
    imageMaxBytes: intEnv('IMAGE_MAX_BYTES', 1048576),
    imageMaxDimension: intEnv('IMAGE_MAX_DIMENSION', 2048),
    modelMaxBytes: intEnv('MODEL_MAX_BYTES', 2097152),
    modelMaxVertices: intEnv('MODEL_MAX_VERTICES', 50000),
    particleMax: intEnv('PARTICLE_MAX', 2000),
    particleSeed: intEnv('PARTICLE_SEED', 7),
    clothSeed: intEnv('CLOTH_SEED', 3),
    grainSeed: intEnv('GRAIN_SEED', 11),
  };
}
