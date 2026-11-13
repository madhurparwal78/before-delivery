/**
 * Fennbright Works Gatecut — configuration read from the environment at
 * start. Nothing here is ever sent to the browser except a presigned
 * manifest link.
 */
export interface AppConfig {
  publicPort: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  valkeyUrl: string;
  amqpUrl: string;
  smtp: { host: string; port: number; from: string };
  mailGroupSeconds: number;
  outboxRetrySeconds: number;
  manifestLinkSeconds: number;
  exportQueue: string;
  exportStepMs: number;
  exportMinuteAllowance: number;
  storageAllowanceBytes: number;
}

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const publicPort = envInt('APP_PUBLIC_PORT', 4173);
  const publicUrl = process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${publicPort}`;
  return {
    publicPort,
    publicUrl: publicUrl.replace(/\/$/, ''),
    databaseUrl: requireEnv('DATABASE_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    valkeyUrl: requireEnv('VALKEY_URL'),
    amqpUrl: requireEnv('AMQP_URL'),
    smtp: {
      host: requireEnv('SMTP_HOST'),
      port: envInt('SMTP_PORT', 25),
      from: process.env.MAIL_FROM ?? 'Gatecut <notes@gatecut.fennbright.example>',
    },
    mailGroupSeconds: envInt('MAIL_GROUP_SECONDS', 60),
    outboxRetrySeconds: envInt('OUTBOX_RETRY_SECONDS', 10),
    manifestLinkSeconds: envInt('MANIFEST_LINK_SECONDS', 900),
    exportQueue: process.env.EXPORT_QUEUE ?? 'gatecut.exports',
    exportStepMs: envInt('EXPORT_STEP_MS', 400),
    exportMinuteAllowance: envInt('EXPORT_MINUTE_ALLOWANCE', 600),
    storageAllowanceBytes: envInt('STORAGE_ALLOWANCE_BYTES', 100000000000),
  };
}
