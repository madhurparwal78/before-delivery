function text(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const config = {
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  wiremockUrl: text('WIREMOCK_URL'),
  port: seconds('APP_PUBLIC_PORT', 4173),
  accessTokenTtlSeconds: seconds('ACCESS_TOKEN_TTL_SECONDS', 600),
  refreshFamilyTtlSeconds: seconds('REFRESH_FAMILY_TTL_SECONDS', 1_209_600),
  webhookNonceTtlSeconds: seconds('WEBHOOK_NONCE_TTL_SECONDS', 600),
  idempotencyKeyTtlSeconds: seconds('IDEMPOTENCY_KEY_TTL_SECONDS', 86_400),
  secretOverlapSeconds: seconds('SECRET_OVERLAP_SECONDS', 600),
} as const;

export const limits = {
  jsonBodyBytes: 65_536,
  eventBodyBytes: 65_536,
  uploadBytes: 5_000_000,
  unfurlBytes: 524_288,
  unfurlTimeoutMs: 3_000,
  lookupTimeoutMs: 3_000,
  bucketCapacity: 8,
  bucketRefillSeconds: 15,
  eventWindowSeconds: 300,
  maxRedirects: 3,
  maxReceiptPages: 5,
  maxAttachmentsPerMessage: 3,
} as const;
