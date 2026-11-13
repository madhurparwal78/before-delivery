function text(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function whole(name: string, fallback: number): number {
  const value = Number(text(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const port = whole('APP_PUBLIC_PORT', 4173);

/** Every environment variable the app reads, read once at start. */
export const config = {
  port,
  publicOrigin: (text('APP_PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  instance: text('INSTANCE_NAME') ?? 'a',
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION') ?? 'us-east-1',
    bucket: text('S3_BUCKET'),
    pathStyle: text('S3_FORCE_PATH_STYLE') !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: text('VALKEY_URL'),
  smtp: { host: text('SMTP_HOST'), port: whole('SMTP_PORT', 25), from: text('MAIL_FROM') ?? 'Keyway Bench <playtests@keyway.test>' },
  playtestDurationSeconds: whole('PLAYTEST_DURATION_SECONDS', 3600),
  hintCooldownSeconds: whole('HINT_COOLDOWN_SECONDS', 120),
  lockTtlSeconds: whole('LOCK_TTL_SECONDS', 30),
} as const;
