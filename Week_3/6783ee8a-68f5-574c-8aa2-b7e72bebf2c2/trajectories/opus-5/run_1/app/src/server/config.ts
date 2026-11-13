import type { PublishedLimits } from '../shared/types.js';

export interface S3Config {
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

export interface SearchConfig {
  url: string;
  apiKey: string;
}

export interface Config {
  databaseUrl: string;
  s3: S3Config;
  mail: MailConfig;
  search: SearchConfig;
  port: number;
  publicUrl: string;
  grading: boolean;
  limits: PublishedLimits;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number above 0`);
  return value;
}

export function loadConfig(): Config {
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
    mail: {
      host: required('SMTP_HOST'),
      port: Number(required('SMTP_PORT')),
      from: required('MAIL_FROM'),
    },
    search: {
      url: required('MEILISEARCH_URL').replace(/\/+$/, ''),
      apiKey: required('MEILISEARCH_API_KEY'),
    },
    port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
    publicUrl: (process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, ''),
    grading: process.env.BRACKENPAD_GRADING === '1',
    limits: {
      double_press_ms: wholeNumber('BRACKENPAD_DOUBLE_PRESS_MS', 500),
      exec_limit_ms: wholeNumber('BRACKENPAD_EXEC_LIMIT_MS', 10000),
      autosave_ms: wholeNumber('BRACKENPAD_AUTOSAVE_MS', 2000),
      output_line_cap: wholeNumber('BRACKENPAD_OUTPUT_LINE_CAP', 200),
      output_byte_cap: wholeNumber('BRACKENPAD_OUTPUT_BYTE_CAP', 1000000),
      table_page_rows: wholeNumber('BRACKENPAD_TABLE_PAGE_ROWS', 25),
      import_max_bytes: wholeNumber('BRACKENPAD_IMPORT_MAX_BYTES', 5000000),
      checkpoints_kept: wholeNumber('BRACKENPAD_CHECKPOINTS_KEPT', 10),
      presence_timeout_ms: wholeNumber('BRACKENPAD_PRESENCE_TIMEOUT_MS', 20000),
    },
  };
}

export const config = loadConfig();

export const MAX_JSON_BODY_BYTES = 8_000_000;
