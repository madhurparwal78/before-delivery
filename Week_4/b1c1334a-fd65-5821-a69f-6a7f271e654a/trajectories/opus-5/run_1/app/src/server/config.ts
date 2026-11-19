function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const port = Number(process.env['APP_PUBLIC_PORT'] ?? '4173');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(required('SMTP_PORT')),
  mailFrom: required('MAIL_FROM'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  port,
  publicUrl: process.env['APP_PUBLIC_URL'] ?? `http://localhost:${port}`,
  idempotencyTtlSeconds: Number(process.env['IDEMPOTENCY_TTL_SECONDS'] ?? '86400'),
} as const;
