function str(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback === undefined) throw new Error(`missing environment variable ${name}`);
    return fallback;
  }
  return value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

const port = int('APP_PUBLIC_PORT', 4173);

export const config = {
  databaseUrl: str('DATABASE_URL'),
  s3: {
    endpoint: str('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: str('SMTP_HOST'), port: int('SMTP_PORT', 1025) },
  mailFrom: str('MAIL_FROM', 'Hushfoot <hello@hushfoot.example>'),
  port,
  publicUrl: str('APP_PUBLIC_URL', `http://localhost:${port}`),
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  worldTickMs: int('WORLD_TICK_MS', 100),
  worldDayTicks: int('WORLD_DAY_TICKS', 14400),
  duskStartHour: int('DUSK_START_HOUR', 18),
  duskEndHour: int('DUSK_END_HOUR', 20),
  rainStartHour: int('RAIN_START_HOUR', 6),
  rainEndHour: int('RAIN_END_HOUR', 9),
  photoTickGrace: int('PHOTO_TICK_GRACE', 30),
  photoMaxBytes: int('PHOTO_MAX_BYTES', 2000000),
  liveIntervalMs: int('LIVE_INTERVAL_MS', 1000),
  safariSeatReleaseSeconds: int('SAFARI_SEAT_RELEASE_SECONDS', 30),
  postcardLimit: int('POSTCARD_LIMIT', 10),
  postcardWindowSeconds: int('POSTCARD_WINDOW_SECONDS', 3600),
  confirmCodeTtlSeconds: int('CONFIRM_CODE_TTL_SECONDS', 86400),
} as const;

export const clockConfig = {
  dayTicks: config.worldDayTicks,
  duskStartHour: config.duskStartHour,
  duskEndHour: config.duskEndHour,
  rainStartHour: config.rainStartHour,
  rainEndHour: config.rainEndHour,
};

export const MAIN_WORLD = 'main';
export const JSON_BODY_LIMIT = 64000;
