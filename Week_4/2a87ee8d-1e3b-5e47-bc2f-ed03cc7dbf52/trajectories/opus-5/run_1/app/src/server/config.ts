function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function intWithDefault(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
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
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly instanceId: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly joinLinkGraceSeconds: number;
  readonly deliveryRetrySeconds: number;
  readonly paymentGraceSeconds: number;
  readonly trashPurgeSeconds: number;
  readonly signinWindowSeconds: number;
}

export function loadConfig(): Config {
  const port = intWithDefault('APP_PUBLIC_PORT', 4173);
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: intWithDefault('SMTP_PORT', 1025),
      from: required('MAIL_FROM'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    instanceId: process.env.INSTANCE_ID ?? 'a',
    port,
    publicBaseUrl,
    joinLinkGraceSeconds: intWithDefault('JOIN_LINK_GRACE_SECONDS', 86400),
    deliveryRetrySeconds: intWithDefault('DELIVERY_RETRY_SECONDS', 15),
    paymentGraceSeconds: intWithDefault('PAYMENT_GRACE_SECONDS', 604800),
    trashPurgeSeconds: intWithDefault('TRASH_PURGE_SECONDS', 2592000),
    signinWindowSeconds: intWithDefault('SIGNIN_WINDOW_SECONDS', 900),
  };
}

export const config: Config = loadConfig();
