function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
}

export interface Config {
  port: number;
  appBaseUrl: string;
  databaseUrl: string;
  inspectionLinkTtlSeconds: number;
  fileUrlTtlSeconds: number;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number; from: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export const config: Config = {
  port: optionalNumber('APP_PUBLIC_PORT', 4173),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:4173',
  databaseUrl: required('DATABASE_URL'),
  inspectionLinkTtlSeconds: optionalNumber('INSPECTION_LINK_TTL_SECONDS', 259_200),
  fileUrlTtlSeconds: optionalNumber('FILE_URL_TTL_SECONDS', 300),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: optionalNumber('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
};
