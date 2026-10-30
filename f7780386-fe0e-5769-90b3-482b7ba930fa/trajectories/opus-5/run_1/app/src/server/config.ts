import { DEFAULT_HOLD_SECONDS } from '../shared/domain.js';
import { KITCHEN_TIME_ZONE, parseInstantWithOffset } from '../shared/time.js';

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
}

export interface Config {
  databaseUrl: string;
  killBill: KillBillConfig;
  storage: StorageConfig;
  smtp: SmtpConfig;
  port: number;
  timeZone: string;
  holdSeconds: number;
  fixedNow: Date | null;
}

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

export function loadConfig(): Config {
  const rawNow = process.env.PASSBOARD_NOW;
  let fixedNow: Date | null = null;
  if (rawNow !== undefined && rawNow !== '') {
    fixedNow = parseInstantWithOffset(rawNow);
    if (fixedNow === null) {
      throw new Error(
        `PASSBOARD_NOW must be an ISO 8601 instant with a UTC offset, for example ` +
          `2027-02-10T07:40:00-06:00 (received "${rawNow}")`,
      );
    }
  }

  const rawHoldSeconds = optional('PASSBOARD_HOLD_SECONDS', String(DEFAULT_HOLD_SECONDS));
  const holdSeconds = Number(rawHoldSeconds);
  if (!Number.isInteger(holdSeconds) || holdSeconds <= 0) {
    throw new Error(
      `PASSBOARD_HOLD_SECONDS must be a whole number of seconds (received "${rawHoldSeconds}")`,
    );
  }

  const rawPort = optional('APP_PUBLIC_PORT', '4173');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`APP_PUBLIC_PORT must be a valid port number (received "${rawPort}")`);
  }

  return {
    databaseUrl: required('DATABASE_URL'),
    killBill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    storage: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: optional('S3_REGION', 'us-east-1'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number(optional('SMTP_PORT', '1025')),
    },
    port,
    timeZone: KITCHEN_TIME_ZONE,
    holdSeconds,
    fixedNow,
  };
}
