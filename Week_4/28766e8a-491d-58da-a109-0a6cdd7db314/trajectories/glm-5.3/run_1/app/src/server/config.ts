export interface AppConfig {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  mailpitUrl: string;
  mailFrom: string;
  appPublicUrl: string;
  gradingRoutes: boolean;
  presenceTimeoutMs: number;
  versionIntervalMs: number;
  inviteTtlMs: number;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: num(env['APP_PUBLIC_PORT'], 4173),
    databaseUrl: env['DATABASE_URL'] ?? '',
    s3: {
      endpoint: env['S3_ENDPOINT'] ?? 'http://127.0.0.1:9000',
      region: env['S3_REGION'] ?? 'us-east-1',
      bucket: env['S3_BUCKET'] ?? 'exports',
      forcePathStyle: env['S3_FORCE_PATH_STYLE'] !== 'false',
      accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '',
    },
    smtp: {
      host: env['SMTP_HOST'] ?? '127.0.0.1',
      port: num(env['SMTP_PORT'], 1025),
    },
    mailpitUrl: env['MAILPIT_URL'] ?? '',
    mailFrom: env['MAIL_FROM'] ?? 'Linewell <hello@linewell.test>',
    appPublicUrl: (env['APP_PUBLIC_URL'] ?? 'http://127.0.0.1:4173').replace(/\/$/, ''),
    gradingRoutes: env['GRADING_ROUTES'] === 'on',
    presenceTimeoutMs: num(env['PRESENCE_TIMEOUT_MS'], 30000),
    versionIntervalMs: num(env['VERSION_INTERVAL_MS'], 300000),
    inviteTtlMs: num(env['INVITE_TTL_MS'], 604800000),
  };
}
