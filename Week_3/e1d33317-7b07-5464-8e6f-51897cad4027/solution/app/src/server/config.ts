// Every service URL and credential is read from the environment here, once. None of it reaches the browser.

function text(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function seconds(name: string, fallback: number): number {
  const value = Number(text(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: Number(text('APP_PUBLIC_PORT') ?? 4173),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION') ?? 'us-east-1',
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: text('VALKEY_URL'),
  gotenbergUrl: text('GOTENBERG_URL'),
  presenceTtlSeconds: seconds('AWARENESS_TTL_SECONDS', 15),
  pdfRetrySeconds: seconds('PDF_RETRY_SECONDS', 30),
} as const
