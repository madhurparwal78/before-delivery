const env = process.env;

function integer(name: string, fallback: number): number {
  const parsed = Number(env[name]);
  return Number.isInteger(parsed) && env[name] !== '' && env[name] !== undefined ? parsed : fallback;
}

/** Everything the server reads from its environment, once, at start. */
export const config = {
  port: integer('APP_PUBLIC_PORT', integer('PORT', 4173)),
  publicUrl: env.APP_PUBLIC_URL ?? '',
  databaseUrl: env.DATABASE_URL ?? '',
  s3: {
    endpoint: env.S3_ENDPOINT ?? '',
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? '',
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
  },
  smtp: { host: env.SMTP_HOST ?? '', port: integer('SMTP_PORT', 1025) },
  mailFrom: env.MAIL_FROM ?? 'Celmate <no-reply@celmate.example>',
  gradingKey: env.GRADING_KEY ?? '',
  startAt: env.CELMATE_START_AT ? Date.parse(env.CELMATE_START_AT) : null,
  limits: {
    paletteMax: integer('CELMATE_PALETTE_MAX', 255),
    spriteMax: integer('CELMATE_SPRITE_MAX', 512),
    frameMinMs: integer('CELMATE_FRAME_MIN_MS', 10),
    frameMaxMs: integer('CELMATE_FRAME_MAX_MS', 65535),
    inviteTtlSeconds: integer('CELMATE_INVITE_TTL_SECONDS', 604800),
    longPressMs: integer('CELMATE_LONG_PRESS_MS', 500),
    presenceVisible: integer('CELMATE_PRESENCE_VISIBLE', 4),
    idleSeconds: integer('CELMATE_IDLE_SECONDS', 300),
    undoDepth: integer('CELMATE_UNDO_DEPTH', 50),
    activityPage: integer('CELMATE_ACTIVITY_PAGE', 50),
    autosaveMs: integer('CELMATE_AUTOSAVE_MS', 1000),
    jobItemMs: integer('CELMATE_JOB_ITEM_MS', 0),
    importMaxBytes: integer('CELMATE_IMPORT_MAX_BYTES', 5000000),
  },
} as const;

export const JSON_BODY_MAX = 1_000_000;
export const SEED_BODY_MAX = 20_000_000;
