import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function intSetting(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  gotenbergUrl: required('GOTENBERG_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY')
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '1025'))
  },
  appPublicPort: optional('APP_PUBLIC_PORT', '4173'),
  appPublicUrl: process.env.APP_PUBLIC_URL || null,
  gradingKey: optional('GRADING_KEY', 'nightroll-grading-5c1e7a'),
  hotelTimeZoneDefault: optional('HOTEL_TIME_ZONE_DEFAULT', 'America/Chicago'),
  checkinLinkTtlSeconds: intSetting('CHECKIN_LINK_TTL_SECONDS', 259200),
  idPhotoMaxBytes: intSetting('ID_PHOTO_MAX_BYTES', 5000000),
  liveMaxDelayMs: intSetting('LIVE_MAX_DELAY_MS', 2000),
  mailFrom: optional('MAIL_FROM', 'Nightroll Desk <desk@nightroll.example>'),
  defaultTaxPercent: '8.75',
  jsonLimitBytes: 1000000
} as const;

export type Config = typeof config;
