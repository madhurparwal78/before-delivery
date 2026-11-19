function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}

export interface Config {
  readonly databaseUrl: string;
  readonly keycloakUrl: string;
  readonly keycloakRealm: string;
  readonly authIssuerUrl: string;
  readonly authClientId: string;
  readonly authClientSecret: string;
  readonly killbillUrl: string;
  readonly killbillUsername: string;
  readonly killbillPassword: string;
  readonly killbillApiKey: string;
  readonly killbillApiSecret: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly amqpUrl: string;
  readonly wiremockUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  readonly gotenbergUrl: string;
  readonly appPublicUrl: string;
  readonly appPublicPort: number;
  readonly holdSeconds: number;
  readonly providerTimeoutSeconds: number;
  readonly renderBackoffSeconds: number;
  readonly refundWindowSeconds: number;
  readonly idempotencyTtlSeconds: number;
  readonly presignSeconds: number;
  readonly renderQueue: string;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  keycloakUrl: required('KEYCLOAK_URL'),
  keycloakRealm: required('KEYCLOAK_REALM'),
  authIssuerUrl: required('AUTH_ISSUER_URL'),
  authClientId: required('AUTH_CLIENT_ID'),
  authClientSecret: required('AUTH_CLIENT_SECRET'),
  killbillUrl: required('KILLBILL_URL'),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  amqpUrl: required('AMQP_URL'),
  wiremockUrl: required('WIREMOCK_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailFrom: required('MAIL_FROM'),
  gotenbergUrl: required('GOTENBERG_URL'),
  appPublicUrl: required('APP_PUBLIC_URL'),
  appPublicPort: integer('APP_PUBLIC_PORT', 4173),
  holdSeconds: integer('HOLD_SECONDS', 600),
  providerTimeoutSeconds: integer('PROVIDER_TIMEOUT_SECONDS', 120),
  renderBackoffSeconds: integer('RENDER_BACKOFF_SECONDS', 5),
  refundWindowSeconds: integer('REFUND_WINDOW_SECONDS', 2592000),
  idempotencyTtlSeconds: integer('IDEMPOTENCY_TTL_SECONDS', 86400),
  presignSeconds: integer('PRESIGN_SECONDS', 300),
  renderQueue: optional('RENDER_QUEUE', 'render.jobs'),
};

export const deadLetterQueue = `${config.renderQueue}.dead`;

/** Identifies this process among instances sharing one database (outbox and retry claims). */
export const instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
