function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function withDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function intWithDefault(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  gotenbergUrl: required('GOTENBERG_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: withDefault('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: withDefault('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: intWithDefault('SMTP_PORT', 1025),
  },
  mailFrom: withDefault('MAIL_FROM', 'Nightroll Desk <desk@nightroll.example>'),
  appPublicPort: intWithDefault('APP_PUBLIC_PORT', 4173),
  appPublicUrl: process.env.APP_PUBLIC_URL ?? '',
  gradingKey: process.env.GRADING_KEY ?? '',
  hotelTimeZoneDefault: withDefault('HOTEL_TIME_ZONE_DEFAULT', 'America/Chicago'),
  checkinLinkTtlSeconds: intWithDefault('CHECKIN_LINK_TTL_SECONDS', 259200),
  idPhotoMaxBytes: intWithDefault('ID_PHOTO_MAX_BYTES', 5000000),
  liveMaxDelayMs: intWithDefault('LIVE_MAX_DELAY_MS', 2000),
  providerTimeoutMs: 5000,
} as const;
