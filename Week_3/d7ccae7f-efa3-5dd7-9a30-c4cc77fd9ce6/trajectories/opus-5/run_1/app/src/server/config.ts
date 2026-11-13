function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`);
  }
  return Math.floor(parsed);
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  port: optionalNumber('APP_PUBLIC_PORT', 4173),
  roomIdleSeconds: optionalNumber('ROOM_IDLE_SECONDS', 1800),
  imageUrlTtlSeconds: optionalNumber('IMAGE_URL_TTL_SECONDS', 120),
} as const;

export const SESSION_COOKIE = 'lastbell_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
