function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: str('DATABASE_URL', 'postgresql://postgres@127.0.0.1:5432/postgres'),
  s3: {
    endpoint: str('S3_ENDPOINT', 'http://127.0.0.1:9000'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', 'hearthtile'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', '')
  },
  mail: {
    host: str('SMTP_HOST', '127.0.0.1'),
    port: int('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Hearthtile <hello@hearthtile.example>')
  },
  valkeyUrl: str('VALKEY_URL', 'redis://127.0.0.1:6379'),
  gradingKey: process.env['GRADING_KEY'] ?? '',
  port: int('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env['APP_PUBLIC_URL'] ?? '',
  instanceName: str('INSTANCE_NAME', 'a'),
  stepMinIntervalMs: int('STEP_MIN_INTERVAL_MS', 200),
  dropGraceSeconds: int('DROP_GRACE_SECONDS', 30),
  voteWindowSeconds: int('VOTE_WINDOW_SECONDS', 60),
  inviteTtlSeconds: int('INVITE_TTL_SECONDS', 604800),
  reminderLeadMinutes: int('REMINDER_LEAD_MINUTES', 60),
  chatMaxChars: int('CHAT_MAX_CHARS', 300),
  sessionCapacityMax: int('SESSION_CAPACITY_MAX', 50)
} as const;

export const JSON_BODY_LIMIT = 64_000;
export const SETUP_BODY_LIMIT = 1_000_000;
export const MULTIPART_LIMIT = 51_000_000;
