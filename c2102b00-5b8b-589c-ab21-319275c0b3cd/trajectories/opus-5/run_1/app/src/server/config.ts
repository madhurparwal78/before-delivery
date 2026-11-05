function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    return '';
  }
  return value;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (value < min || value > max) return fallback;
  return value;
}

export const config = {
  port: intEnv('APP_PUBLIC_PORT', 4173, 1, 65535),
  dbPath: env('TALLY_DB_PATH', 'data/tally.db'),
  kbKeyPrefix: env('TALLY_KB_KEY_PREFIX', 'tally'),
  mailRetrySeconds: intEnv('MAIL_RETRY_SECONDS', 30, 1, 300),
  killbill: {
    url: env('KILLBILL_URL'),
    username: env('KILLBILL_USERNAME'),
    password: env('KILLBILL_PASSWORD'),
    apiKey: env('KILLBILL_API_KEY'),
    apiSecret: env('KILLBILL_API_SECRET'),
  },
  mail: {
    host: env('SMTP_HOST'),
    port: intEnv('SMTP_PORT', 1025, 1, 65535),
    from: env('MAIL_FROM'),
  },
  s3: {
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'us-east-1'),
    bucket: env('S3_BUCKET'),
    forcePathStyle: env('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
  },
} as const;

export const mailEndpoint = `${config.mail.host}:${config.mail.port}`;
