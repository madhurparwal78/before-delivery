/** Settings read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function optionalWholeNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

const port = wholeNumber('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  databaseUrl: required('DATABASE_URL'),
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: wholeNumber('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  publicUrl: (process.env['APP_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  editWindowSeconds: wholeNumber('EDIT_WINDOW_SECONDS', 86_400),
  mentionUnansweredSeconds: wholeNumber('MENTION_UNANSWERED_SECONDS', 1_800),
  digestIntervalSeconds: optionalWholeNumber('DIGEST_INTERVAL_SECONDS'),
  eventRetentionSeconds: wholeNumber('EVENT_RETENTION_SECONDS', 600),
  appClockOffsetSeconds: wholeNumber('APP_CLOCK_OFFSET_SECONDS', 0),
} as const;

export const LIMITS = {
  jsonBodyBytes: 64_000,
  multipartBodyBytes: 41_000_000,
  photoBytes: 10_000_000,
  photoPixels: 40_000_000,
  photosPerMessage: 4,
  textCharacters: 4_000,
  pinsPerChannel: 3,
  sendsPerMinute: 20,
  pageLimitDefault: 30,
  pageLimitMax: 100,
  searchQueryMin: 2,
  searchQueryMax: 200,
  searchTermsMax: 8,
  receiptIdsMax: 100,
  thumbLongestSide: 320,
} as const;
