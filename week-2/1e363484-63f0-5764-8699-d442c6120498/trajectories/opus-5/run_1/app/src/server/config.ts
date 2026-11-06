function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a whole number of seconds`);
  }
  return parsed;
}

const port = seconds('APP_PUBLIC_PORT', 4173);

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port,
  appPublicUrl: optional('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  storage: {
    endpoint: optional('S3_ENDPOINT', '').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: optional('S3_BUCKET', ''),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
  },
  mail: {
    host: optional('SMTP_HOST', ''),
    port: seconds('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Fluxseal <seals@sedgemoor.example>'),
  },
  linkTtlSeconds: seconds('LINK_TTL_SECONDS', 2_592_000),
  idempotencyTtlSeconds: seconds('IDEMPOTENCY_TTL_SECONDS', 86_400),
  sessionTtlSeconds: seconds('SESSION_TTL_SECONDS', 43_200),
} as const;
