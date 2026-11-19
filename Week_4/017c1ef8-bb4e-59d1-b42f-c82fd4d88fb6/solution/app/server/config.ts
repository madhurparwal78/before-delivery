function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number.parseInt(value, 10) : fallback;
}

const listenPort = process.env.APP_PUBLIC_PORT ?? process.env.PORT ?? '4173';
const startAt = process.env.PLAINWORK_START_AT;

export const config = {
  port: Number.parseInt(listenPort, 10),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: integer('SMTP_PORT', 1025), from: required('MAIL_FROM') },
  gradingKey: process.env.GRADING_KEY ?? '',
  startAt: startAt ? new Date(startAt) : null,
  timeZone: process.env.PLAINWORK_TIME_ZONE ?? 'UTC',
  inviteCooldownSeconds: integer('PLAINWORK_INVITE_COOLDOWN_SECONDS', 1814400),
  weeklyInvites: integer('PLAINWORK_WEEKLY_INVITES', 100),
  postMaxChars: integer('PLAINWORK_POST_MAX_CHARS', 3000),
  seeMoreChars: integer('PLAINWORK_SEE_MORE_CHARS', 210),
  editWindowSeconds: integer('PLAINWORK_EDIT_WINDOW_SECONDS', 3600),
  typingTimeoutMs: integer('PLAINWORK_TYPING_TIMEOUT_MS', 5000),
  maxSkills: integer('PLAINWORK_MAX_SKILLS', 50),
  photoMaxBytes: integer('PLAINWORK_PHOTO_MAX_BYTES', 5000000),
  resumeMaxBytes: integer('PLAINWORK_RESUME_MAX_BYTES', 2000000),
  feedPageSize: integer('PLAINWORK_FEED_PAGE_SIZE', 10),
  maxWithdrawBatch: 50,
  commentMaxChars: 1250,
  messageMaxChars: 8000,
  messagePageSize: 50,
  skillNameMax: 40,
  featuredLimit: 3,
  newerEntriesLimit: 50,
} as const;

export const DAY_SECONDS = 86400;
export const WEEK_SECONDS = 7 * DAY_SECONDS;
export const MONTH_SECONDS = 30 * DAY_SECONDS;
export const JSON_BODY_LIMIT = 1_000_000;
export const MULTIPART_SLACK = 65_536;
