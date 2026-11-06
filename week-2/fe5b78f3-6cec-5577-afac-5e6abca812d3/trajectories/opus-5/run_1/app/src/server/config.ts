function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export interface Config {
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly clock: { readonly start: string | null; readonly rate: number };
  readonly app: { readonly port: number; readonly publicUrl: string };
}

export function loadConfig(): Config {
  const rate = Number.parseInt(optional('RAIL_CLOCK_RATE', '1'), 10);
  if (!Number.isInteger(rate) || rate < 1 || rate > 3600) {
    throw new Error('RAIL_CLOCK_RATE must be an integer from 1 to 3600');
  }
  const start = process.env.RAIL_CLOCK_START;
  return {
    databaseUrl: required('DATABASE_URL'),
    killbill: {
      url: required('KILLBILL_URL'),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number.parseInt(required('SMTP_PORT'), 10),
      from: required('MAIL_FROM'),
    },
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    clock: { start: start === undefined || start === '' ? null : start, rate },
    app: {
      port: Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10),
      publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
    },
  };
}
