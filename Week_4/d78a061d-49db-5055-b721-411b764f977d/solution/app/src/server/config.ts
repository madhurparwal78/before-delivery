function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: intFromEnv('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  port: intFromEnv('APP_PUBLIC_PORT', 4173),
  rejoinGraceSeconds: intFromEnv('REJOIN_GRACE_SECONDS', 120),
  mailLinkTtlSeconds: intFromEnv('MAIL_LINK_TTL_SECONDS', 1800),
} as const;

export const publicOrigin = new URL(config.publicUrl).origin;
