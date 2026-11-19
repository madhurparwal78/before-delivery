function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function port(): number {
  const explicit = process.env.APP_PUBLIC_PORT ?? process.env.PORT;
  if (explicit && explicit.trim() !== '') {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 4173;
}

export const config = {
  port: port(),
  databaseUrl: str('DATABASE_URL', ''),
  gradingKey: process.env.GRADING_KEY ?? '',
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: {
    host: str('SMTP_HOST', 'localhost'),
    port: num('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Plainwork <no-reply@plainwork.example>'),
  },
  startAt: str('PLAINWORK_START_AT', new Date().toISOString()),
  timeZone: str('PLAINWORK_TIME_ZONE', 'UTC'),
  inviteCooldownSeconds: num('PLAINWORK_INVITE_COOLDOWN_SECONDS', 1814400),
  weeklyInvites: num('PLAINWORK_WEEKLY_INVITES', 100),
  postMaxChars: num('PLAINWORK_POST_MAX_CHARS', 3000),
  seeMoreChars: num('PLAINWORK_SEE_MORE_CHARS', 210),
  editWindowSeconds: num('PLAINWORK_EDIT_WINDOW_SECONDS', 3600),
  typingTimeoutMs: num('PLAINWORK_TYPING_TIMEOUT_MS', 5000),
  maxSkills: num('PLAINWORK_MAX_SKILLS', 50),
  photoMaxBytes: num('PLAINWORK_PHOTO_MAX_BYTES', 5000000),
  resumeMaxBytes: num('PLAINWORK_RESUME_MAX_BYTES', 2000000),
  feedPageSize: num('PLAINWORK_FEED_PAGE_SIZE', 10),
} as const;

export const WEEK_SECONDS = 604800;
export const COMMENT_MAX_CHARS = 1250;
export const MESSAGE_MAX_CHARS = 8000;
export const MAX_QUESTIONS = 10;
export const MAX_FEATURED_SKILLS = 3;
export const JSON_BODY_LIMIT = 1000000;
