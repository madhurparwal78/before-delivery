function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a whole number`);
  }
  return parsed;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gotenbergUrl: required('GOTENBERG_URL'),
  wiremockUrl: required('WIREMOCK_URL'),
  techLinkSeconds: whole('TECH_LINK_SECONDS', 1_209_600),
  readingStaleSeconds: whole('READING_STALE_SECONDS', 10_368_000),
  maskStepMilliseconds: whole('MASK_STEP_MILLISECONDS', 0),
} as const;
