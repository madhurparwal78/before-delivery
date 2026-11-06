import type { AddonDeadlineConfig } from '../shared/addons';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface TimerConfig {
  deviceApprovalTtlSeconds: number;
  inviteTtlSeconds: number;
  previewTtlSeconds: number;
  idempotencyTtlSeconds: number;
  sweepIntervalSeconds: number;
}

export interface Config {
  databaseUrl: string;
  s3: S3Config;
  killbill: KillBillConfig;
  mail: MailConfig;
  port: number;
  publicUrl: string;
  timers: TimerConfig;
  deadlines: AddonDeadlineConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid environment variable ${name}`);
  return value;
}

function optionalSeconds(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid environment variable ${name}`);
  return value;
}

export function loadConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const sweepInterval = Math.min(60, Math.max(1, seconds('CAIRN_SWEEP_INTERVAL_SECONDS', 30)));
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    mail: {
      host: required('SMTP_HOST'),
      port: Number(required('SMTP_PORT')),
      from: required('MAIL_FROM'),
    },
    port,
    publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    timers: {
      deviceApprovalTtlSeconds: seconds('CAIRN_DEVICE_APPROVAL_TTL_SECONDS', 1800),
      inviteTtlSeconds: seconds('CAIRN_INVITE_TTL_SECONDS', 604800),
      previewTtlSeconds: seconds('CAIRN_PREVIEW_TTL_SECONDS', 259200),
      idempotencyTtlSeconds: seconds('CAIRN_IDEMPOTENCY_TTL_SECONDS', 86400),
      sweepIntervalSeconds: sweepInterval,
    },
    deadlines: {
      syncGraceSeconds: optionalSeconds('CAIRN_SYNC_GRACE_SECONDS'),
      publishRetentionSeconds: optionalSeconds('CAIRN_PUBLISH_RETENTION_SECONDS'),
      publishWarningLeadSeconds: optionalSeconds('CAIRN_PUBLISH_WARNING_LEAD_SECONDS'),
    },
  };
}
