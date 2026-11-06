export interface Env {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
    keyPrefix: string; // '' or 'prefix-'
  };
  mail: { host: string; port: number; from: string };
  timers: {
    sessionLifetimeSeconds: number;
    startupOverdueSeconds: number;
    estimateExpirySeconds: number;
  };
  appPublicUrl: string;
  port: number;
}

function readNumber(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return def;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return def;
  return value;
}

export function loadEnv(): Env {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      throw new Error(`Missing environment variable ${name}`);
    }
    return value;
  };
  const prefix = (process.env.KILLBILL_KEY_PREFIX || '').trim();
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION || 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
      keyPrefix: prefix ? `${prefix}-` : '',
    },
    mail: {
      host: required('SMTP_HOST'),
      port: readNumber('SMTP_PORT', 1025),
      from: required('MAIL_FROM'),
    },
    timers: {
      sessionLifetimeSeconds: readNumber('SESSION_LIFETIME_SECONDS', 43200),
      startupOverdueSeconds: readNumber('STARTUP_OVERDUE_SECONDS', 2592000),
      estimateExpirySeconds: readNumber('ESTIMATE_EXPIRY_SECONDS', 1209600),
    },
    appPublicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
    port: readNumber('APP_PUBLIC_PORT', 4173),
  };
}
