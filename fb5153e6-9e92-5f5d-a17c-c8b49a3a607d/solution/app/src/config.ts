/**
 * Every provider URL and credential is read from the environment here, once, at
 * start. Nothing in this module is ever serialised into a response or a page.
 */

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function retrySeconds(raw: string): readonly number[] {
  const parts = raw
    .split(',')
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isSafeInteger(n) && n >= 0);
  return parts.length > 0 ? parts : [30, 120, 600];
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
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly mail: { readonly host: string; readonly port: number; readonly from: string };
  readonly search: { readonly url: string; readonly apiKey: string; readonly index: string };
  readonly instance: string;
  readonly queueRetrySeconds: readonly number[];
  readonly port: number;
  readonly publicUrl: string;
}

export const config: Config = {
  databaseUrl: req('DATABASE_URL'),
  s3: {
    endpoint: req('S3_ENDPOINT').replace(/\/+$/, ''),
    region: opt('S3_REGION', 'us-east-1'),
    bucket: req('S3_BUCKET'),
    forcePathStyle: opt('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: req('S3_ACCESS_KEY_ID'),
    secretAccessKey: req('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: req('KILLBILL_URL').replace(/\/+$/, ''),
    username: req('KILLBILL_USERNAME'),
    password: req('KILLBILL_PASSWORD'),
    apiKey: req('KILLBILL_API_KEY'),
    apiSecret: req('KILLBILL_API_SECRET'),
  },
  mail: {
    host: req('SMTP_HOST'),
    port: Number.parseInt(opt('SMTP_PORT', '1025'), 10),
    from: req('MAIL_FROM'),
  },
  search: {
    url: req('MEILISEARCH_URL').replace(/\/+$/, ''),
    apiKey: opt('MEILISEARCH_API_KEY', ''),
    index: opt('MEILISEARCH_INDEX', 'models'),
  },
  instance: opt('STUDIO_INSTANCE', 'main'),
  queueRetrySeconds: retrySeconds(opt('QUEUE_RETRY_SECONDS', '30,120,600')),
  port: Number.parseInt(opt('APP_PUBLIC_PORT', '4173'), 10),
  publicUrl: opt('APP_PUBLIC_URL', `http://127.0.0.1:${opt('APP_PUBLIC_PORT', '4173')}`).replace(
    /\/+$/,
    '',
  ),
};
