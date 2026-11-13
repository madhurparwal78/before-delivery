function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const port = number('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: number('SMTP_PORT', 1025) },
  mailFrom: optional('MAIL_FROM', 'Overcall <scorers@overcall.test>'),
  gradingKey: required('GRADING_KEY'),
  appBaseUrl: optional('APP_BASE_URL', optional('APP_PUBLIC_URL', `http://localhost:${port}`)),
  appTz: optional('APP_TZ', 'Asia/Kolkata'),
  liveDelayMs: number('LIVE_DELAY_MS', 3000),
  penGraceMs: number('PEN_GRACE_MS', 2000),
  tickMs: number('TICK_MS', 260),
  tickStaggerMs: number('TICK_STAGGER_MS', 80),
  superOverMax: number('SUPER_OVER_MAX', 2),
  inviteTtlHours: number('INVITE_TTL_HOURS', 48),
  inviteRatePerHour: number('INVITE_RATE_PER_HOUR', 20),
  logoMaxBytes: number('LOGO_MAX_BYTES', 1048576),
  maxJsonBytes: 65536,
  maxSeedBytes: 1048576,
} as const;
