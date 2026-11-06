function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function presenceIdleSeconds(): number {
  const raw = process.env.PRESENCE_IDLE_SECONDS;
  if (raw === undefined || raw === '') return 60;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error('PRESENCE_IDLE_SECONDS must be a whole number from 1 to 3600');
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  presenceIdleSeconds: presenceIdleSeconds(),
} as const;
