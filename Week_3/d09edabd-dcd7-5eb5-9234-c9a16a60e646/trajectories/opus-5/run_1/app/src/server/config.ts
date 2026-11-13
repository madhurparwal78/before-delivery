/** Every service URL, credential and timing, read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`environment variable ${name} is not a number`);
  return parsed;
}

const port = number('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicOrigin: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  instanceName: optional('INSTANCE_NAME', 'a'),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: required('VALKEY_URL'),
  mail: {
    host: required('SMTP_HOST'),
    port: number('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  playtestDurationSeconds: number('PLAYTEST_DURATION_SECONDS', 3600),
  hintCooldownSeconds: number('HINT_COOLDOWN_SECONDS', 120),
  lockTtlSeconds: number('LOCK_TTL_SECONDS', 30),
} as const;

export const limits = {
  json: 100_000,
  multipart: 5_100_000,
  propFile: 5_000_000,
  thumbnail: 500_000,
} as const;
