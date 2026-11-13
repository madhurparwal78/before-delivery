const num = (name: string, def: number): number => {
  const raw = process.env[name];
  if (!raw) return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
};

export const config = {
  port: num('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL || `http://localhost:${num('APP_PUBLIC_PORT', 4173)}`,
  databaseUrl: process.env.DATABASE_URL || '',
  valkeyUrl: process.env.VALKEY_URL || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: num('SMTP_PORT', 25),
  mailFrom: process.env.MAIL_FROM || 'Keyway Bench <playtests@keyway.test>',
  instance: process.env.INSTANCE_NAME || 'a',
  playtestDuration: num('PLAYTEST_DURATION_SECONDS', 3600),
  hintCooldown: num('HINT_COOLDOWN_SECONDS', 120),
  lockTtl: num('LOCK_TTL_SECONDS', 30),
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  limits: { json: 100_000, multipart: 5_100_000, propFile: 5_000_000, thumbnail: 500_000 },
};

export type Config = typeof config;
