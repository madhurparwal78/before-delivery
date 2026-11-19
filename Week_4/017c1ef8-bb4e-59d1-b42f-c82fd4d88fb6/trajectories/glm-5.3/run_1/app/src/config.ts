const int = (name: string, fallback: number): number => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
};

export const config = {
  port: int('APP_PUBLIC_PORT', int('PORT', 4173)) || 4173,
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int('SMTP_PORT', 1025),
  },
  mailFrom: process.env.MAIL_FROM ?? '',
  gradingKey: process.env.GRADING_KEY ?? '',
  startAt: process.env.PLAINWORK_START_AT ?? '',
  timeZone: process.env.PLAINWORK_TIME_ZONE || 'UTC',
  inviteCooldownSeconds: int('PLAINWORK_INVITE_COOLDOWN_SECONDS', 1814400),
  weeklyInvites: int('PLAINWORK_WEEKLY_INVITES', 100),
  postMaxChars: int('PLAINWORK_POST_MAX_CHARS', 3000),
  seeMoreChars: int('PLAINWORK_SEE_MORE_CHARS', 210),
  editWindowSeconds: int('PLAINWORK_EDIT_WINDOW_SECONDS', 3600),
  typingTimeoutMs: int('PLAINWORK_TYPING_TIMEOUT_MS', 5000),
  maxSkills: int('PLAINWORK_MAX_SKILLS', 50),
  photoMaxBytes: int('PLAINWORK_PHOTO_MAX_BYTES', 5000000),
  resumeMaxBytes: int('PLAINWORK_RESUME_MAX_BYTES', 2000000),
  feedPageSize: int('PLAINWORK_FEED_PAGE_SIZE', 10),
};

export const requiredEnv = (): void => {
  required('DATABASE_URL');
  required('S3_ENDPOINT');
  required('S3_BUCKET');
};
