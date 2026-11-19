function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: flag('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY')
  },
  valkeyUrl: required('VALKEY_URL'),
  gradingKey: optional('GRADING_KEY'),
  instanceName: process.env.INSTANCE_NAME ?? 'a',
  port: number('APP_PUBLIC_PORT', 4173),
  breakoutSeconds: number('BREAKOUT_SECONDS', 480),
  breakoutWarningSeconds: number('BREAKOUT_WARNING_SECONDS', 30),
  breakoutExtendSeconds: number('BREAKOUT_EXTEND_SECONDS', 120),
  lateAfterMinutes: number('LATE_AFTER_MINUTES', 5),
  leftEarlyMinutes: number('LEFT_EARLY_MINUTES', 10),
  reconnectGraceSeconds: number('RECONNECT_GRACE_SECONDS', 90),
  slideMaxBytes: number('SLIDE_MAX_BYTES', 5_000_000),
  modelMaxBytes: number('MODEL_MAX_BYTES', 10_000_000),
  slidesMaxPerLesson: number('SLIDES_MAX_PER_LESSON', 40),
  chatMaxChars: number('CHAT_MAX_CHARS', 300),
  maxJsonBytes: 100_000,
  maxUploadBytes: 250_000_000
} as const;
