function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: process.env['S3_REGION'] ?? 'us-east-1',
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') !== 'false',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  port: optionalNumber('APP_PUBLIC_PORT', 4173),
  lockoutWindowSeconds: optionalNumber('QUIRE_LOCKOUT_WINDOW_SECONDS', 900),
  sessionIdleSeconds: optionalNumber('QUIRE_SESSION_IDLE_SECONDS', 1_209_600),
};
