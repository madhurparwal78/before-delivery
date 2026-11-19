function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

const port = num('APP_PUBLIC_PORT', 4173);

export interface Config {
  port: number;
  databaseUrl: string;
  appBaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: { host: string; port: number; from: string };
  inviteTtlSeconds: number;
  inviteWindowSeconds: number;
  idempotencyTtlSeconds: number;
  mentionRetrySeconds: number;
  shareLinkTtlSeconds: number;
}

export const config: Config = {
  port,
  databaseUrl: str('DATABASE_URL', ''),
  appBaseUrl: str('APP_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  mail: {
    host: str('SMTP_HOST', ''),
    port: num('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Marginalia <no-reply@marginalia.test>'),
  },
  inviteTtlSeconds: num('INVITE_TTL_SECONDS', 604800),
  inviteWindowSeconds: num('INVITE_WINDOW_SECONDS', 3600),
  idempotencyTtlSeconds: num('IDEMPOTENCY_TTL_SECONDS', 86400),
  mentionRetrySeconds: num('MENTION_RETRY_SECONDS', 600),
  shareLinkTtlSeconds: num('SHARE_LINK_TTL_SECONDS', 2592000),
};
