// Configuration, read from the environment at start (DP-40).

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(name: string, fallback: string): string {
  return process.env[name] || fallback
}

export const config = {
  databaseUrl: str('DATABASE_URL', ''),
  valkeyUrl: str('VALKEY_URL', ''),
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', '')
  },
  gradingKey: str('GRADING_KEY', ''),
  instanceName: str('INSTANCE_NAME', 'a'),
  port: num('APP_PUBLIC_PORT', 4173),
  breakoutSeconds: num('BREAKOUT_SECONDS', 480),
  breakoutWarningSeconds: num('BREAKOUT_WARNING_SECONDS', 30),
  breakoutExtendSeconds: num('BREAKOUT_EXTEND_SECONDS', 120),
  lateAfterMinutes: num('LATE_AFTER_MINUTES', 5),
  leftEarlyMinutes: num('LEFT_EARLY_MINUTES', 10),
  reconnectGraceSeconds: num('RECONNECT_GRACE_SECONDS', 90),
  slideMaxBytes: num('SLIDE_MAX_BYTES', 5000000),
  modelMaxBytes: num('MODEL_MAX_BYTES', 10000000),
  slidesMaxPerLesson: num('SLIDES_MAX_PER_LESSON', 40),
  chatMaxChars: num('CHAT_MAX_CHARS', 300),
  jsonMaxBytes: 100000,
  uploadMaxBytes: 250000000
}
