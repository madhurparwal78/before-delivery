import { randomBytes } from 'node:crypto';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: number('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  publicPort: number('APP_PUBLIC_PORT', 4173),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  gradingKey: required('GRADING_KEY'),
  appStartAt: optional('APP_START_AT', '2026-03-02T09:00:00+01:00'),
  timeZone: optional('APP_TIME_ZONE', 'Europe/Berlin'),
  downloadLinkTtlSeconds: number('DOWNLOAD_LINK_TTL_SECONDS', 300),
  deadlineHoursStandard: number('DEADLINE_HOURS_STANDARD', 24),
  deadlineHoursExtended: number('DEADLINE_HOURS_EXTENDED', 48),
  deadlineHoursLegal: number('DEADLINE_HOURS_LEGAL', 72),
  deadlineWarningPercent: number('DEADLINE_WARNING_PERCENT', 75),
  expiryCeilingMultiplier: number('EXPIRY_CEILING_MULTIPLIER', 2),
  proofMaxBytes: number('PROOF_MAX_BYTES', 5242880),
  weightAnnounceDelayMs: number('WEIGHT_ANNOUNCE_DELAY_MS', 300),
  submitDedupSeconds: number('SUBMIT_DEDUP_SECONDS', 10),
  inviteTtlHours: number('INVITE_TTL_HOURS', 72),
  sessionCookieName: optional('SESSION_COOKIE_NAME', 'rulehouse_session'),
  linkSigningSecret: optional('LINK_SIGNING_SECRET', randomBytes(32).toString('hex')),
} as const;

export const JSON_BODY_LIMIT = 100_000;
export const DERIVATIVE_MAX_BYTES = 10_485_760;
