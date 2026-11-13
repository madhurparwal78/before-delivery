function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a whole number of seconds`);
  return parsed;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  wiremockUrl: required('WIREMOCK_URL').replace(/\/+$/, ''),
  accessTokenTtlSeconds: seconds('ACCESS_TOKEN_TTL_SECONDS', 600),
  refreshFamilyTtlSeconds: seconds('REFRESH_FAMILY_TTL_SECONDS', 1_209_600),
  webhookNonceTtlSeconds: seconds('WEBHOOK_NONCE_TTL_SECONDS', 600),
  idempotencyKeyTtlSeconds: seconds('IDEMPOTENCY_KEY_TTL_SECONDS', 86_400),
  secretOverlapSeconds: seconds('SECRET_OVERLAP_SECONDS', 600),
} as const;
