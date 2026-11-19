import { toIso, daysFromCivil } from '../shared/dates.js';
import type { IsoDate } from '../shared/dates.js';

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function text(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL || `http://localhost:${integer('APP_PUBLIC_PORT', 4173)}`,
  databaseUrl: text('DATABASE_URL', ''),
  planToday: process.env.PLAN_TODAY || null,
  timeZone: text('PLAN_TIME_ZONE', 'UTC'),
  gradingKey: process.env.GRADING_KEY || null,
  assignNoticeDelaySeconds: integer('ASSIGN_NOTICE_DELAY_SECONDS', 60),
  presenceTimeoutSeconds: integer('PRESENCE_TIMEOUT_SECONDS', 15),
  knockOnMs: integer('KNOCK_ON_MS', 220),
  knockOnStaggerMs: integer('KNOCK_ON_STAGGER_MS', 45),
  finishMotionMs: integer('FINISH_MOTION_MS', 320),
  s3: {
    endpoint: text('S3_ENDPOINT', ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: {
    host: text('SMTP_HOST', ''),
    port: integer('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Slackwater Plan <plans@slackwater.test>'),
  },
};

/** Today, from the server's configuration: PLAN_TODAY when set, else the date in PLAN_TIME_ZONE. */
export function today(): IsoDate {
  if (config.planToday) return config.planToday;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): number => Number(parts.find((part) => part.type === type)!.value);
  return toIso(daysFromCivil(get('year'), get('month'), get('day')));
}
