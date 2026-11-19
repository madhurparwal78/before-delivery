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
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer for ${name}`);
  return parsed;
}

const port = integer('APP_PUBLIC_PORT', integer('PORT', 4173));

export const env = {
  port,
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Mothlight <hello@mothlight.example>'),
  },
  publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  gradingKey: process.env.GRADING_KEY ?? null,
  startAt: process.env.MOTHLIGHT_START_AT ?? null,
  timeZone: optional('MOTHLIGHT_TIME_ZONE', 'UTC'),
  undoSeconds: integer('MOTHLIGHT_UNDO_SECONDS', 30),
  inviteTtlSeconds: integer('MOTHLIGHT_INVITE_TTL_SECONDS', 604800),
  limits: {
    imageMaxBytes: integer('MOTHLIGHT_IMAGE_MAX_BYTES', 10000000),
    imageMaxPixels: integer('MOTHLIGHT_IMAGE_MAX_PIXELS', 40000000),
    titleMax: integer('MOTHLIGHT_TITLE_MAX', 100),
    descriptionMax: integer('MOTHLIGHT_DESCRIPTION_MAX', 500),
    commentMax: integer('MOTHLIGHT_COMMENT_MAX', 500),
    boardNameMax: integer('MOTHLIGHT_BOARD_NAME_MAX', 50),
  },
} as const;

export const JSON_BODY_MAX = 65536;
export const MULTIPART_OVERHEAD = 65536;
export const ALT_MAX = 500;
