// Every setting the server reads from the environment, read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE').toLowerCase() !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  port: Number(process.env.APP_PUBLIC_PORT) || 4173,
  lockoutWindowSeconds: seconds('QUIRE_LOCKOUT_WINDOW_SECONDS', 900),
  sessionIdleSeconds: seconds('QUIRE_SESSION_IDLE_SECONDS', 1_209_600),
};
