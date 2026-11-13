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

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return parsed;
}

function secondsOrNull(name: string): number | null {
  const value = process.env[name];
  if (value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return parsed;
}

/** Every credential and address the app uses, read from the environment at start. */
export const env = {
  port: Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/$/, ''),

  databaseUrl: required('DATABASE_URL'),

  keycloakUrl: required('KEYCLOAK_URL').replace(/\/$/, ''),
  keycloakRealm: required('KEYCLOAK_REALM'),
  authIssuerUrl: required('AUTH_ISSUER_URL').replace(/\/$/, ''),
  authClientId: required('AUTH_CLIENT_ID'),
  authClientSecret: required('AUTH_CLIENT_SECRET'),

  killbillUrl: required('KILLBILL_URL').replace(/\/$/, ''),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),

  smtpHost: required('SMTP_HOST'),
  smtpPort: Number.parseInt(required('SMTP_PORT'), 10),
  mailFrom: required('MAIL_FROM'),

  s3Endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),

  gotenbergUrl: required('GOTENBERG_URL').replace(/\/$/, ''),

  svixUrl: required('SVIX_URL').replace(/\/$/, ''),
  svixApiKey: required('SVIX_API_KEY'),

  ntfyUrl: required('NTFY_URL').replace(/\/$/, ''),
  ntfyUsername: required('NTFY_USERNAME'),
  ntfyPassword: required('NTFY_PASSWORD'),

  wiremockUrl: required('WIREMOCK_URL').replace(/\/$/, ''),
  renderWebhookSecret: optional('RENDER_WEBHOOK_SECRET', 'spindrift-render-dev-secret'),

  holdSeconds: seconds('HOLD_SECONDS', 720),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 604800),
  quoteTtlSeconds: secondsOrNull('QUOTE_TTL_SECONDS'),
  accessTtlSeconds: seconds('ACCESS_TTL_SECONDS', 300),
} as const;

export const CREW_TOPIC = 'spindrift-crew';
