/** Every service URL, credential and tuning value is read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly pickupWindowSeconds: number;
  readonly reminderLeadSeconds: number;
}

export function loadConfig(): Config {
  return {
    port: integer('APP_PUBLIC_PORT', 4173),
    databaseUrl: required('DATABASE_URL'),
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: integer('SMTP_PORT', 1025),
      from: required('MAIL_FROM'),
    },
    pickupWindowSeconds: integer('SHEDLINE_PICKUP_WINDOW_SECONDS', 172_800),
    reminderLeadSeconds: integer('SHEDLINE_REMINDER_LEAD_SECONDS', 86_400),
  };
}

export const JSON_BODY_LIMIT = 16_384;
export const PHOTO_BODY_LIMIT = 5_500_000;
export const PHOTO_BYTE_LIMIT = 5_000_000;
export const PHOTOS_PER_STAGE = 4;
export const DEPENDENCY_TIMEOUT_MS = 5_000;
export const PROBE_MAX_AGE_MS = 5_000;
