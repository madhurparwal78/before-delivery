export type Role = 'producer' | 'client' | 'sponsor' | 'crew';

export interface Config {
  databaseUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  authIssuerUrl: string;
  authClientId: string;
  authClientSecret: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  gotenbergUrl: string;
  svixUrl: string;
  svixApiKey: string;
  ntfyUrl: string;
  ntfyUsername: string;
  ntfyPassword: string;
  wiremockUrl: string;
  renderWebhookSecret: string;
  holdSeconds: number;
  inviteTtlSeconds: number;
  quoteTtlSeconds: number | null;
  accessTtlSeconds: number;
  publicUrl: string;
  port: number;
}

function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : dflt;
}

export function loadConfig(): Config {
  const publicUrl = (process.env['APP_PUBLIC_URL'] ?? 'http://127.0.0.1:4173').replace(/\/+$/, '');
  const unsetQuote = process.env['QUOTE_TTL_SECONDS'] === undefined || process.env['QUOTE_TTL_SECONDS'] === '';
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    keycloakUrl: requireEnv('KEYCLOAK_URL'),
    keycloakRealm: requireEnv('KEYCLOAK_REALM'),
    authIssuerUrl: requireEnv('AUTH_ISSUER_URL'),
    authClientId: requireEnv('AUTH_CLIENT_ID'),
    authClientSecret: requireEnv('AUTH_CLIENT_SECRET'),
    killbillUrl: requireEnv('KILLBILL_URL'),
    killbillUsername: requireEnv('KILLBILL_USERNAME'),
    killbillPassword: requireEnv('KILLBILL_PASSWORD'),
    killbillApiKey: requireEnv('KILLBILL_API_KEY'),
    killbillApiSecret: requireEnv('KILLBILL_API_SECRET'),
    smtpHost: requireEnv('SMTP_HOST'),
    smtpPort: num(process.env['SMTP_PORT'], 1025),
    mailFrom: requireEnv('MAIL_FROM'),
    s3Endpoint: requireEnv('S3_ENDPOINT'),
    s3Region: requireEnv('S3_REGION') ?? 'us-east-1',
    s3Bucket: requireEnv('S3_BUCKET'),
    s3ForcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    s3AccessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    gotenbergUrl: requireEnv('GOTENBERG_URL'),
    svixUrl: requireEnv('SVIX_URL'),
    svixApiKey: requireEnv('SVIX_API_KEY'),
    ntfyUrl: requireEnv('NTFY_URL'),
    ntfyUsername: requireEnv('NTFY_USERNAME'),
    ntfyPassword: requireEnv('NTFY_PASSWORD'),
    wiremockUrl: requireEnv('WIREMOCK_URL'),
    renderWebhookSecret: process.env['RENDER_WEBHOOK_SECRET'] ?? 'spindrift-render-dev-secret',
    holdSeconds: num(process.env['HOLD_SECONDS'], 720),
    inviteTtlSeconds: num(process.env['INVITE_TTL_SECONDS'], 604800),
    quoteTtlSeconds: unsetQuote ? null : num(process.env['QUOTE_TTL_SECONDS'], 720),
    accessTtlSeconds: num(process.env['ACCESS_TTL_SECONDS'], 300),
    publicUrl,
    port: num(process.env['APP_PUBLIC_PORT'], 4173),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}
