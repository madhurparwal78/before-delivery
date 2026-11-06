/** Every service address, credential and tunable is read from the environment here and nowhere else. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export interface Config {
  databaseUrl: string;
  port: number;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number; from: string };
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  holdTtlSeconds: number;
  complianceScanSeconds: number;
  outboxRetrySeconds: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  port: integer('APP_PUBLIC_PORT', 4173),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (optional('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  holdTtlSeconds: integer('HOLD_TTL_SECONDS', 600),
  complianceScanSeconds: integer('COMPLIANCE_SCAN_SECONDS', 60),
  outboxRetrySeconds: integer('OUTBOX_RETRY_SECONDS', 30),
};

/** The longest any outbound call to Kill Bill, Mailpit or MinIO may take. */
export const SERVICE_TIMEOUT_MS = 5_000;
/** The shorter budget for the reads that must answer within three seconds. */
export const QUICK_SERVICE_TIMEOUT_MS = 2_000;
