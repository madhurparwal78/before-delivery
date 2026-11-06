function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const port = Number(process.env['APP_PUBLIC_PORT'] ?? 4173);

export const config = {
  port,
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
  },
  mailFrom: required('MAIL_FROM'),
  publicUrl: (process.env['APP_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  gradingRoutes: process.env['GRADING_ROUTES'] === 'on',
  presenceTimeoutMs: Number(process.env['PRESENCE_TIMEOUT_MS'] ?? 30000),
} as const;

export const MAX_JSON_BODY = 1_000_000;
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_UPLOAD_BODY = 5_100_000;
