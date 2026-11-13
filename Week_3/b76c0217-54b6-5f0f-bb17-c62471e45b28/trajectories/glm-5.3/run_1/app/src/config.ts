function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}`);
  return Math.floor(n);
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
  },
  mailpitUrl: required('MAILPIT_URL'),
  mailFrom: required('MAIL_FROM'),
  appPublicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  inviteTtlMs: integer('INVITE_TTL_MS', 604800000),
  mailRetryMs: integer('MAIL_RETRY_MS', 60000),
  previewLinkTtlMs: integer('PREVIEW_LINK_TTL_MS', 259200000),
  presenceTimeoutMs: integer('PRESENCE_TIMEOUT_MS', 30000),
  port: (() => {
    const raw = process.env.APP_PUBLIC_PORT;
    if (raw === undefined || raw === '') return 4173;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid APP_PUBLIC_PORT');
    return n;
  })(),
};

export type AppConfig = typeof config;
