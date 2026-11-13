function text(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = Number(text(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const port = integer('APP_PUBLIC_PORT', 4173);

/** Every service URL, credential and time setting, read from the environment at start. */
export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: text('VALKEY_URL'),
  smtp: {
    host: text('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: text('MAIL_FROM'),
  },
  lockTtlSeconds: integer('LOCK_TTL_SECONDS', 30),
  presenceTtlSeconds: integer('PRESENCE_TTL_SECONDS', 20),
  inviteTtlSeconds: integer('INVITE_TTL_SECONDS', 604800),
  shareLinkTtlSeconds: integer('SHARE_LINK_TTL_SECONDS', 2592000),
} as const;

export function publicAddress(path: string): string {
  return `${config.publicUrl}${path}`;
}
