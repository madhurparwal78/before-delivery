function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function holdSeconds(): number {
  const raw = process.env.PILOTLIGHT_HOLD_SECONDS;
  if (raw === undefined || raw === '') return 600;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
    throw new Error('PILOTLIGHT_HOLD_SECONDS must be a whole number of seconds from 1 to 3600');
  }
  return parsed;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  holdSeconds: holdSeconds(),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
  },
} as const;

export const MAIL_SENDER = 'Pilotlight <no-reply@pilotlight.test>';
