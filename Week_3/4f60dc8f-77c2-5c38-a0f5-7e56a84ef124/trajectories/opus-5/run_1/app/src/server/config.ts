const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
};

const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

const seconds = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`bad seconds in ${name}`);
  return parsed;
};

export type Config = {
  port: number;
  publicUrl: string | null;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  mail: { host: string; port: number; from: string; mailpitUrl: string };
  pocketbase: { url: string; adminEmail: string; adminPassword: string };
  amqpUrl: string;
  gotenbergUrl: string;
  meilisearch: { url: string; apiKey: string };
  ntfy: { url: string; username: string; password: string; topic: string };
  signinCodeTtlSeconds: number;
  signinCodeWindowSeconds: number;
  reviewLinkTtlSeconds: number;
  overdueAfterSeconds: number;
  idempotencyKeyTtlSeconds: number;
};

export const loadConfig = (): Config => ({
  port: Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10),
  publicUrl: process.env.APP_PUBLIC_URL?.replace(/\/+$/, '') || null,
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number.parseInt(optional('SMTP_PORT', '1025'), 10),
    from: optional('MAIL_FROM', 'Gloamwork Studio <studio@gloamwork.test>'),
    mailpitUrl: optional('MAILPIT_URL', '').replace(/\/+$/, ''),
  },
  pocketbase: {
    url: required('POCKETBASE_URL').replace(/\/+$/, ''),
    adminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    adminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
  },
  amqpUrl: required('AMQP_URL'),
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
  meilisearch: {
    url: required('MEILISEARCH_URL').replace(/\/+$/, ''),
    apiKey: optional('MEILISEARCH_API_KEY', ''),
  },
  ntfy: {
    url: required('NTFY_URL').replace(/\/+$/, ''),
    username: optional('NTFY_USERNAME', ''),
    password: optional('NTFY_PASSWORD', ''),
    topic: 'gloamwork-studio',
  },
  signinCodeTtlSeconds: seconds('SIGNIN_CODE_TTL_SECONDS', 600),
  signinCodeWindowSeconds: seconds('SIGNIN_CODE_WINDOW_SECONDS', 900),
  reviewLinkTtlSeconds: seconds('REVIEW_LINK_TTL_SECONDS', 1_209_600),
  overdueAfterSeconds: seconds('OVERDUE_AFTER_SECONDS', 1_209_600),
  idempotencyKeyTtlSeconds: seconds('IDEMPOTENCY_KEY_TTL_SECONDS', 86_400),
});

export const config: Config = loadConfig();
