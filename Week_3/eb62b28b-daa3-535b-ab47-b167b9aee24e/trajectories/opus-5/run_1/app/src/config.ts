function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be a number`);
  return Math.trunc(value);
}

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killBill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  mail: { host: string; port: number; from: string };
  publicPort: number;
  publicUrl: string;
  sessionSeconds: number;
  messageRateWindowSeconds: number;
  fileRateWindowSeconds: number;
  closureWaitSeconds: number;
  drawPageSeconds: number | null;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killBill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  publicPort: seconds('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${seconds('APP_PUBLIC_PORT', 4173)}`,
  sessionSeconds: seconds('SESSION_SECONDS', 43200),
  messageRateWindowSeconds: seconds('MESSAGE_RATE_WINDOW_SECONDS', 3600),
  fileRateWindowSeconds: seconds('FILE_RATE_WINDOW_SECONDS', 3600),
  closureWaitSeconds: seconds('CLOSURE_WAIT_SECONDS', 2592000),
  drawPageSeconds:
    process.env.DRAW_PAGE_SECONDS === undefined || process.env.DRAW_PAGE_SECONDS === ''
      ? null
      : seconds('DRAW_PAGE_SECONDS', 0),
};
