/** Every credential, URL and timer comes from the environment and never reaches the browser. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string {
  return process.env[name] ?? '';
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return Number(raw.trim());
}

export interface Config {
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
    readonly keyPrefix: string;
  };
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly from: string;
  };
  readonly sessionLifetimeSeconds: number;
  readonly startupOverdueSeconds: number;
  readonly estimateExpirySeconds: number;
  readonly publicUrl: string;
  readonly port: number;
}

function keyPrefix(): string {
  const raw = optional('KILLBILL_KEY_PREFIX');
  return raw === '' ? '' : `${raw}-`;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
    keyPrefix: keyPrefix(),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  sessionLifetimeSeconds: wholeSeconds('SESSION_LIFETIME_SECONDS', 43200),
  startupOverdueSeconds: wholeSeconds('STARTUP_OVERDUE_SECONDS', 2592000),
  estimateExpirySeconds: wholeSeconds('ESTIMATE_EXPIRY_SECONDS', 1209600),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  port: wholeSeconds('APP_PUBLIC_PORT', 4173),
};

export const JSON_BODY_LIMIT = 100_000;
export const UPLOAD_BODY_LIMIT = 10_000_000;
export const SESSION_COOKIE = 'lacquer_session';
