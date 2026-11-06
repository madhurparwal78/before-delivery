function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export interface Config {
  databaseUrl: string;
  smtp: { host: string; port: number; from: string };
  killBill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  port: number;
  billingRetrySeconds: number;
  sessionTtlSeconds: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  killBill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  port: integer('APP_PUBLIC_PORT', 4173),
  billingRetrySeconds: integer('BILLING_RETRY_SECONDS', 10),
  sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 43200),
};
