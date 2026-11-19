function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export interface Env {
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly from: string;
  };
  readonly port: number;
  readonly publicUrl: string;
  readonly reminderSweepSeconds: number;
  readonly sessionIdleSeconds: number;
}

export const env: Env = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE').toLowerCase() === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  port: boundedInteger('APP_PUBLIC_PORT', 4173, 1, 65535),
  publicUrl: (process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  reminderSweepSeconds: boundedInteger('REMINDER_SWEEP_SECONDS', 60, 1, 60),
  sessionIdleSeconds: boundedInteger('SESSION_IDLE_SECONDS', 1800, 10, 86400),
};
