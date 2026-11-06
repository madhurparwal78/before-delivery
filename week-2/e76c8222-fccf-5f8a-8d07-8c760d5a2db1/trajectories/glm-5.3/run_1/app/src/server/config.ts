const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

const port = Number(env.APP_PUBLIC_PORT ?? 4173);

export const config = {
  port,
  publicUrl: (env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    mailpitUrl: required('MAILPIT_URL'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
} as const;

export const PASSCODE = 'weave-demo-2026';
export const AGENCY_TZ = 'America/New_York';
