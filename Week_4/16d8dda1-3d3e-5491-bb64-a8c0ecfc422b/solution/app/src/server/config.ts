function text(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
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
  gradingKey: text('GRADING_KEY'),
  instanceName: text('INSTANCE_NAME', 'a'),
  port: integer('APP_PUBLIC_PORT', 4173),
  breakoutSeconds: integer('BREAKOUT_SECONDS', 480),
  breakoutWarningSeconds: integer('BREAKOUT_WARNING_SECONDS', 30),
  breakoutExtendSeconds: integer('BREAKOUT_EXTEND_SECONDS', 120),
  lateAfterMinutes: integer('LATE_AFTER_MINUTES', 5),
  leftEarlyMinutes: integer('LEFT_EARLY_MINUTES', 10),
  reconnectGraceSeconds: integer('RECONNECT_GRACE_SECONDS', 90),
  slideMaxBytes: integer('SLIDE_MAX_BYTES', 5_000_000),
  modelMaxBytes: integer('MODEL_MAX_BYTES', 10_000_000),
  slidesMaxPerLesson: integer('SLIDES_MAX_PER_LESSON', 40),
  chatMaxChars: integer('CHAT_MAX_CHARS', 300),
} as const;
