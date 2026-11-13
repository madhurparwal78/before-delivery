export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

export interface Config {
  databaseUrl: string;
  storage: StorageConfig;
  mail: MailConfig;
  port: number;
  reminderSweepSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function wholeNumberInRange(name: string, fallback: number, low: number, high: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new Error(`${name} must be a whole number from ${low} to ${high}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    storage: {
      endpoint: optional('S3_ENDPOINT', ''),
      region: optional('S3_REGION', 'us-east-1'),
      bucket: optional('S3_BUCKET', ''),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
    },
    mail: {
      host: optional('SMTP_HOST', ''),
      port: wholeNumberInRange('SMTP_PORT', 1025, 1, 65535),
      from: optional('MAIL_FROM', 'Quirewell Library <library@quirewell.test>'),
    },
    port: wholeNumberInRange('APP_PUBLIC_PORT', 4173, 1, 65535),
    reminderSweepSeconds: wholeNumberInRange('REMINDER_SWEEP_SECONDS', 30, 1, 60),
  };
}

export const config: Config = loadConfig();
