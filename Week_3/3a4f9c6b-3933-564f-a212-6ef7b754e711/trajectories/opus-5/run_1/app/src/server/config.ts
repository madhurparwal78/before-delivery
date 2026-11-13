function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive whole number of seconds`);
  }
  return parsed;
}

const port = Number(process.env.APP_PUBLIC_PORT ?? '') || 4173;

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
    port: Number(required('SMTP_PORT')),
  },
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  approvalTtlSeconds: seconds('KEELSON_APPROVAL_TTL_SECONDS', 14_400),
  sessionTtlSeconds: seconds('KEELSON_SESSION_TTL_SECONDS', 43_200),
  requestKeyTtlSeconds: seconds('KEELSON_REQUEST_KEY_TTL_SECONDS', 86_400),
} as const;

export const mailFrom = { name: 'Keelson', address: 'keelson@tideline.test' } as const;
