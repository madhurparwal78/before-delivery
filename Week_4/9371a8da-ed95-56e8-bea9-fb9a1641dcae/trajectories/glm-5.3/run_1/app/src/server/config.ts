/** Reads configuration from the environment at start. */

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function strEnv(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? def : raw;
}

export interface Config {
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
  smtp: { host: string; port: number; from: string };
  appBaseUrl: string;
  inviteTtlSeconds: number;
  inviteWindowSeconds: number;
  idempotencyTtlSeconds: number;
  mentionRetrySeconds: number;
  shareLinkTtlSeconds: number;
}

export function readConfig(): Config {
  const port = intEnv('APP_PUBLIC_PORT', 4173);
  return {
    port,
    databaseUrl: strEnv('DATABASE_URL', 'postgresql://localhost:5432/marginalia'),
    s3: {
      endpoint: strEnv('S3_ENDPOINT', 'http://localhost:9000'),
      region: strEnv('S3_REGION', 'us-east-1'),
      bucket: strEnv('S3_BUCKET', 'marginalia'),
      forcePathStyle: strEnv('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: strEnv('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: strEnv('S3_SECRET_ACCESS_KEY', ''),
    },
    smtp: {
      host: strEnv('SMTP_HOST', 'localhost'),
      port: intEnv('SMTP_PORT', 1025),
      from: strEnv('MAIL_FROM', 'Marginalia <no-reply@marginalia.test>'),
    },
    appBaseUrl: strEnv('APP_BASE_URL', `http://localhost:${port}`).replace(/\/$/, ''),
    inviteTtlSeconds: intEnv('INVITE_TTL_SECONDS', 604800),
    inviteWindowSeconds: intEnv('INVITE_WINDOW_SECONDS', 3600),
    idempotencyTtlSeconds: intEnv('IDEMPOTENCY_TTL_SECONDS', 86400),
    mentionRetrySeconds: intEnv('MENTION_RETRY_SECONDS', 600),
    shareLinkTtlSeconds: intEnv('SHARE_LINK_TTL_SECONDS', 2592000),
  };
}
