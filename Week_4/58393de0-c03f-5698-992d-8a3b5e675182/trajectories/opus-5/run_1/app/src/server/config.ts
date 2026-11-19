/** Every service address, credential, token and timer is read from the environment once at start. */

const str = (name: string, fallback?: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be a whole number`);
  return value;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
};

export const config = {
  databaseUrl: str('DATABASE_URL'),
  s3: {
    endpoint: str('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 1025),
    from: str('MAIL_FROM'),
  },
  port: int('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  gradingToken: str('GRADING_TOKEN', 'qy-grading-local'),
  timers: {
    autosaveMs: int('QY_AUTOSAVE_MS', 1500),
    blocksStepMs: int('QY_BLOCKS_STEP_MS', 400),
    simTickMs: int('QY_SIM_TICK_MS', 100),
    toastMs: int('QY_TOAST_MS', 4000),
    glancetFadeMs: int('QY_GLANCET_FADE_MS', 150),
  },
  joinRateLimit: int('QY_JOIN_RATE_LIMIT', 5),
  verifyTtlSeconds: int('QY_VERIFY_TTL_SECONDS', 86400),
} as const;

export const publicOrigin = new URL(config.publicUrl).origin;
