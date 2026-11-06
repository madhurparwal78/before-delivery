function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

const port = integer('APP_PUBLIC_PORT', 4173, 1, 65535);

const summaryTime = (() => {
  const raw = process.env.SUMMARY_LOCAL_TIME;
  if (raw && /^\d{2}:\d{2}$/.test(raw.trim())) {
    const [h, m] = raw.trim().split(':').map(Number);
    if (h <= 23 && m <= 59) return { hour: h, minute: m };
  }
  return { hour: 18, minute: 0 };
})();

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: integer('SMTP_PORT', 1025, 1, 65535),
  },
  mailFrom: process.env.MAIL_FROM ?? 'Snaglight <notices@snaglight.example>',
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  sessionIdleMinutes: integer('SESSION_IDLE_MINUTES', 720, 1, 525600),
  summaryTime,
  summaryQuietSeconds: integer('SUMMARY_QUIET_SECONDS', 60, 0, 60),
  eventRetentionCount: integer('EVENT_RETENTION_COUNT', 1000, 10, 100000),
} as const;

export const JSON_BODY_LIMIT = 1_000_000;
export const MULTIPART_BODY_LIMIT = 10_500_000;
export const IMAGE_BYTE_LIMIT = 10_000_000;
