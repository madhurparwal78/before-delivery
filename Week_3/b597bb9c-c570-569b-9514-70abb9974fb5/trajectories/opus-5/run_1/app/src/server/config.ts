/** Every service URL, credential and tunable is read from the environment here. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly valkeyUrl: string;
  readonly amqpUrl: string;
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly mailGroupSeconds: number;
  readonly outboxRetrySeconds: number;
  readonly manifestLinkSeconds: number;
  readonly exportQueue: string;
  readonly exportStepMs: number;
  readonly exportMinuteAllowance: number;
  readonly storageAllowanceBytes: number;
}

export const config: Config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: required('VALKEY_URL'),
  amqpUrl: required('AMQP_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Gatecut <notes@gatecut.fennbright.example>'),
  },
  mailGroupSeconds: whole('MAIL_GROUP_SECONDS', 60),
  outboxRetrySeconds: whole('OUTBOX_RETRY_SECONDS', 10),
  manifestLinkSeconds: whole('MANIFEST_LINK_SECONDS', 900),
  exportQueue: optional('EXPORT_QUEUE', 'gatecut.exports'),
  exportStepMs: whole('EXPORT_STEP_MS', 400),
  exportMinuteAllowance: whole('EXPORT_MINUTE_ALLOWANCE', 600),
  storageAllowanceBytes: whole('STORAGE_ALLOWANCE_BYTES', 100000000000),
};

export const UPLOAD_CHUNK_BYTES = 5242880;
export const JSON_BODY_LIMIT = 1000000;
export const SRT_BODY_LIMIT = 1000000;
